import { describe, expect, it } from "vitest";
import { expenseCapabilities } from "./expense-capabilities";
import type { Capability, CostAllocation, Expense, ExpenseStatus, Role } from "./types";
import { DEFAULT_ROLE_CAPABILITIES } from "@/lib/server/authority-defaults";
import { today } from "./date";

const alloc = (over: Partial<CostAllocation> = {}): CostAllocation => ({
  id: "a1",
  costCenterId: "cc1",
  costCenterCode: "SEX01",
  costCenterName: "Sexmästeriet",
  amount: 450,
  ...over,
});

const expense = (over: Partial<Expense> = {}): Expense => ({
  id: "e1",
  reference: "DEK26-0042",
  title: "Kolsyra",
  submitterId: "member",
  submitterName: "Medlem",
  submitterStudentId: "me1234dl-s",
  allocations: [alloc()],
  paymentType: "REIMBURSEMENT",
  status: "APPROVED",
  purchaseDate: "2026-03-01",
  grossAmount: 450,
  currency: "SEK",
  submitterHasPayout: true,
  revisions: [],
  receipts: [],
  updatedAt: "2026-03-02T10:00:00.000Z",
  ...over,
});

// A viewer holding these roles, with the capabilities those roles have on the day the database is created (lib/server/authority-defaults.ts).
const capsFor = (roles: Role[]): Capability[] => [
  ...new Set(
    DEFAULT_ROLE_CAPABILITIES.filter((r) => roles.includes(r.role)).map((r) => r.capability),
  ),
];

const viewer = (roles: Role[], id = "someone-else") => ({
  id,
  roles,
  capabilities: capsFor(roles),
});

describe("exporting to Fortnox", () => {
  // Exporting is a Fortnox call under the bookkeeper's own login: narrower than bookkeeping access.
  const booked = expense({ status: "BOOKED" });

  it("is offered to the treasury, who can log in to Fortnox", () => {
    for (const role of ["SKATTMASTARE", "VICE_SKATTMASTARE", "SKATTFORMAN"] as Role[]) {
      expect(expenseCapabilities(booked, viewer([role])).canExport).toBe(true);
    }
  });

  it("is not offered to the ordförande, who cannot", () => {
    // They hold bookkeeping access and no Fortnox account.
    expect(expenseCapabilities(booked, viewer(["ORDFORANDE"])).canExport).toBe(false);
  });

  it("is not offered before the utlägg is booked", () => {
    const approved = expense({ status: "APPROVED" });
    expect(expenseCapabilities(approved, viewer(["SKATTMASTARE"])).canExport).toBe(false);
  });
});

describe("editing", () => {
  const draft = expense({ status: "DRAFT", reference: undefined });

  it("belongs to the submitter", () => {
    expect(expenseCapabilities(draft, viewer(["ORDINARIE"], "member")).canEdit).toBe(true);
  });

  it("and to an admin", () => {
    expect(expenseCapabilities(draft, viewer(["SKATTMASTARE"])).canEdit).toBe(true);
  });

  it("but not to a resultatansvarig who may merely see it", () => {
    // Seeing an utlägg is not editing it (`canEditExpense` on the server).
    expect(expenseCapabilities(draft, viewer(["RESULTATANSVARIG"])).canEdit).toBe(false);
  });

  it("stops once the utlägg is signed", () => {
    const booked = expense({ status: "BOOKED" });
    expect(expenseCapabilities(booked, viewer(["SKATTMASTARE"])).canEdit).toBe(false);
  });
});

describe("attesting", () => {
  const pending = expense({
    status: "PENDING_APPROVAL",
    allocations: [alloc({ canAttest: true })],
  });

  it("is offered where the server said the viewer has authority", () => {
    // `canAttest` is stamped per allocation by the loader, which knows the viewer's result units.
    expect(expenseCapabilities(pending, viewer(["RESULTATANSVARIG"])).canApprove).toBe(true);
  });

  it("is not offered where it did not", () => {
    const other = expense({
      status: "PENDING_APPROVAL",
      allocations: [alloc({ canAttest: false })],
    });
    expect(expenseCapabilities(other, viewer(["RESULTATANSVARIG"])).canApprove).toBe(false);
  });

  it("is not offered on an allocation somebody already signed", () => {
    const signed = expense({
      status: "PENDING_APPROVAL",
      allocations: [alloc({ canAttest: true, approvedById: "someone" })],
    });
    expect(expenseCapabilities(signed, viewer(["SKATTMASTARE"])).canApprove).toBe(false);
  });

  it("can be taken back by whoever signed it", () => {
    const mine = expense({
      status: "APPROVED",
      allocations: [alloc({ canAttest: true, approvedById: "me" })],
    });
    const can = expenseCapabilities(mine, viewer(["RESULTATANSVARIG"], "me"));
    expect(can.canWithdrawAttest).toBe(true);
  });

  it("cannot be taken back once it is booked", () => {
    const booked = expense({
      status: "BOOKED",
      allocations: [alloc({ canAttest: true, approvedById: "me" })],
    });
    expect(expenseCapabilities(booked, viewer(["RESULTATANSVARIG"], "me")).canWithdrawAttest).toBe(
      false,
    );
  });
});

describe("submitting a milersättning", () => {
  // The claim carries its journey rather than a receipt, so the journey check has to run. Driven today,
  // not on the shared fixture's March date: a milersättning has the 60-day deadline, reported ahead of
  // anything else. The route is filled in everywhere, since a missing route is its own blocker.
  const JOURNEY = { stops: ["Kårhuset, Lund", "Snabbgross", "Kårhuset, Lund"] };
  const mileage = (over: Partial<Expense> = {}) =>
    expense({
      paymentType: "MILEAGE",
      status: "DRAFT",
      submitterId: "member",
      purchaseDate: today(),
      mileage: {
        ...JOURNEY,
        odometerStart: 12300,
        odometerEnd: 12342,
        km: 42,
        orePerKm: 250,
      },
      ...over,
    });
  const owner = viewer(["ORDINARIE"], "member");

  it("is offered on a claim whose journey is complete and valued", () => {
    const can = expenseCapabilities(mileage(), owner);
    expect(can.submitBlocker).toBeNull();
    expect(can.canSubmit).toBe(true);
  });

  it("is refused while the readings do not make a journey", () => {
    const can = expenseCapabilities(
      mileage({
        mileage: {
          ...JOURNEY,
          odometerStart: 12300,
          odometerEnd: null,
          km: null,
          orePerKm: 250,
        },
      }),
      owner,
    );
    expect(can.submitBlocker).toBe("mileage");
    expect(can.canSubmit).toBe(false);
  });

  it("is refused while nothing has priced the day it was driven", () => {
    const can = expenseCapabilities(
      mileage({
        mileage: {
          ...JOURNEY,
          odometerStart: 12300,
          odometerEnd: 12342,
          km: 42,
          orePerKm: null,
        },
      }),
      owner,
    );
    expect(can.submitBlocker).toBe("mileage");
  });

  it("is refused while the journey names fewer than two places", () => {
    // Priceable readings, so what is missing is the route, which the transition route refuses on.
    const journey = { odometerStart: 12300, odometerEnd: 12342, km: 42, orePerKm: 250 };
    expect(
      expenseCapabilities(mileage({ mileage: { ...journey, stops: [] } }), owner).submitBlocker,
    ).toBe("mileage");
    expect(
      expenseCapabilities(mileage({ mileage: { ...journey, stops: ["Lund"] } }), owner)
        .submitBlocker,
    ).toBe("mileage");
    // Blank rows are not places, however many an editor left behind.
    expect(
      expenseCapabilities(mileage({ mileage: { ...journey, stops: ["Lund", "  ", ""] } }), owner)
        .submitBlocker,
    ).toBe("mileage");
  });

  it("is never asked for a receipt", () => {
    // A mileage claim has no receipt and is not meant to.
    expect(expenseCapabilities(mileage(), owner).submitBlocker).not.toBe("receipt");
  });

  it("still has the filing deadline over it", () => {
    // Out of the claimant's own pocket, so the same 60 days, reported ahead of the journey check.
    expect(expenseCapabilities(mileage({ purchaseDate: "2020-01-01" }), owner).submitBlocker).toBe(
      "tooLate",
    );
  });
});

describe("dispens från redovisningsfristen", () => {
  // The skattmästare letting one late eget utlägg be filed anyway (dispens columns on Expense).
  const late = (over: Partial<Expense> = {}) =>
    expense({
      status: "DRAFT",
      submitterId: "member",
      paymentType: "REIMBURSEMENT",
      purchaseDate: "2020-01-01",
      // The underlag, so these cases are about the deadline.
      receipts: [{ id: "r1", filename: "kvitto.jpg", mimeType: "image/jpeg" }],
      ...over,
    });
  const granted = {
    by: "Nora Lindqvist",
    at: "2026-03-05T10:00:00.000Z",
    reason: "Kvittot kom bort i flytten.",
  };

  it("is the skattmästare's, and nobody else's", () => {
    // ORDFORANDE is an admin here and still not this: departing from a rule is the treasurer's.
    expect(expenseCapabilities(late(), viewer(["SKATTMASTARE"])).canWaiveDeadline).toBe(true);
    expect(expenseCapabilities(late(), viewer(["ORDFORANDE"])).canWaiveDeadline).toBe(false);
    expect(expenseCapabilities(late(), viewer(["VICE_SKATTMASTARE"])).canWaiveDeadline).toBe(false);
    expect(expenseCapabilities(late(), viewer(["ORDINARIE"], "member")).canWaiveDeadline).toBe(
      false,
    );
  });

  it("is offered only before the utlägg goes for attest", () => {
    // The deadline stops a late claim from entering the queue, so a later dispens would permit what already happened.
    const skattm = viewer(["SKATTMASTARE"]);
    for (const status of ["DRAFT", "CHANGES_REQUESTED"] as ExpenseStatus[]) {
      expect(expenseCapabilities(late({ status }), skattm).canWaiveDeadline).toBe(true);
    }
    for (const status of [
      "PENDING_APPROVAL",
      "APPROVED",
      "BOOKED",
      "EXPORTED",
    ] as ExpenseStatus[]) {
      expect(expenseCapabilities(late({ status }), skattm).canWaiveDeadline).toBe(false);
    }
  });

  it("is not offered on a claim that is in time", () => {
    // A dispens on a claim nobody was stopping would leave a reason nobody can read back.
    const skattm = viewer(["SKATTMASTARE"]);
    expect(expenseCapabilities(late({ purchaseDate: today() }), skattm).canWaiveDeadline).toBe(
      false,
    );
    // Nor on a sektionskort purchase: the deadline was never over it.
    expect(expenseCapabilities(late({ paymentType: "CARD" }), skattm).canWaiveDeadline).toBe(false);
  });

  it("becomes the offer to take it back, once given", () => {
    const skattm = viewer(["SKATTMASTARE"]);
    const can = expenseCapabilities(late({ deadlineWaiver: granted }), skattm);
    expect(can.canWaiveDeadline).toBe(false);
    expect(can.canRevokeDeadlineWaiver).toBe(true);
    expect(
      expenseCapabilities(late({ deadlineWaiver: granted }), viewer(["ORDFORANDE"]))
        .canRevokeDeadlineWaiver,
    ).toBe(false);
  });

  it("lifts the deadline for the submitter, and lifts nothing else", () => {
    // The submitter sees only the block lifting, same as everybody else.
    const owner = viewer(["ORDINARIE"], "member");
    expect(expenseCapabilities(late(), owner).submitBlocker).toBe("tooLate");

    const waived = late({ deadlineWaiver: granted });
    expect(expenseCapabilities(waived, owner).submitBlocker).toBeNull();
    expect(expenseCapabilities(waived, owner).canSubmit).toBe(true);

    expect(expenseCapabilities({ ...waived, submitterHasPayout: false }, owner).submitBlocker).toBe(
      "payout",
    );
  });
});

describe("deleting", () => {
  it("is the submitter's right until the utlägg is signed", () => {
    const draft = expense({ status: "DRAFT" });
    expect(expenseCapabilities(draft, viewer(["ORDINARIE"], "member")).canDelete).toBe(true);
  });

  it("stops being it once it is attested", () => {
    const approved = expense({ status: "APPROVED" });
    expect(expenseCapabilities(approved, viewer(["ORDINARIE"], "member")).canDelete).toBe(false);
  });

  it("remains an admin's at any point, it is the section's record", () => {
    const exported = expense({ status: "EXPORTED" });
    expect(expenseCapabilities(exported, viewer(["SKATTMASTARE"])).canDelete).toBe(true);
  });
});

describe("the panel as a whole", () => {
  it("offers nothing on somebody else's exported utlägg", () => {
    const exported = expense({ status: "EXPORTED" });
    const can = expenseCapabilities(exported, viewer(["ORDINARIE"]));
    expect(can.hasAnyAction).toBe(false);
  });

  it("says so when the only thing on offer is a secondary action", () => {
    const draft = expense({ status: "DRAFT", grossAmount: 0, receipts: [] });
    const can = expenseCapabilities(draft, viewer(["ORDINARIE"], "member"));
    // Nothing to submit yet but still theirs to edit and throw away.
    expect(can.hasPrimaryAction).toBe(false);
    expect(can.hasAnyAction).toBe(true);
  });
});

describe("statuses are covered, not assumed", () => {
  const all: ExpenseStatus[] = [
    "DRAFT",
    "PENDING_APPROVAL",
    "CHANGES_REQUESTED",
    "APPROVED",
    "BOOKED",
    "EXPORTED",
  ];

  it("answers for every status without throwing", () => {
    // A guard on the enum: a status added and forgotten here crashes instead of showing an empty panel.
    for (const status of all) {
      const can = expenseCapabilities(expense({ status }), viewer(["SKATTMASTARE"]));
      expect(typeof can.hasAnyAction).toBe("boolean");
    }
  });
});

describe("taking your own submission back", () => {
  // The submitter's counterpart to withdrawing an attest: this takes back the claim, that a signature.
  const waiting = (over: Partial<Expense> = {}) =>
    expense({ status: "PENDING_APPROVAL", submitterId: "member", ...over });

  it("is offered to whoever submitted it", () => {
    expect(expenseCapabilities(waiting(), viewer([], "member")).canRecall).toBe(true);
  });

  it("is offered to an admin, who may act on their behalf", () => {
    expect(expenseCapabilities(waiting(), viewer(["SKATTMASTARE"], "other")).canRecall).toBe(true);
  });

  it("is not offered to anybody else", () => {
    // A resultatansvarig may attest it, which does not make the claim theirs to withdraw.
    expect(expenseCapabilities(waiting(), viewer(["RESULTATANSVARIG"], "other")).canRecall).toBe(
      false,
    );
  });

  it("is not offered once it is actually attested", () => {
    // Undoing an attest is bookkeeping's call (`canReturn`).
    for (const status of ["APPROVED", "BOOKED", "EXPORTED"] as ExpenseStatus[]) {
      expect(expenseCapabilities(waiting({ status }), viewer([], "member")).canRecall).toBe(false);
    }
  });

  it("is not offered on one already back in the submitter's hands", () => {
    for (const status of ["DRAFT", "CHANGES_REQUESTED"] as ExpenseStatus[]) {
      expect(expenseCapabilities(waiting({ status }), viewer([], "member")).canRecall).toBe(false);
    }
  });

  it("is the only way to change one that is out for attest", () => {
    // Editing is closed while somebody is being asked to sign, and taking it back reopens it.
    const can = expenseCapabilities(waiting(), viewer([], "member"));
    expect(can.canEdit).toBe(false);
    expect(can.canRecall).toBe(true);
  });

  it("hands editing back once it is a draft again", () => {
    const back = expenseCapabilities(waiting({ status: "DRAFT" }), viewer([], "member"));
    expect(back.canEdit).toBe(true);
    expect(back.canRecall).toBe(false);
  });

  it("counts as something the panel can offer", () => {
    // A claim waiting for attest has no primary action for its own submitter.
    const can = expenseCapabilities(waiting(), viewer([], "member"));
    expect(can.hasAnyAction).toBe(true);
  });
});

describe("reminding", () => {
  const pending = expense({ status: "PENDING_APPROVAL" });

  it("is offered to the admins by default", () => {
    for (const role of ["SKATTMASTARE", "ORDFORANDE"] as Role[]) {
      expect(expenseCapabilities(pending, viewer([role])).canRemind).toBe(true);
    }
  });

  it("is not offered to everyone else until a role is given it", () => {
    for (const role of ["VICE_SKATTMASTARE", "RESULTATANSVARIG", "ORDINARIE"] as Role[]) {
      expect(expenseCapabilities(pending, viewer([role])).canRemind).toBe(false);
    }
  });

  it("is offered while the utlägg is waiting on its submitter", () => {
    for (const status of ["DRAFT", "CHANGES_REQUESTED"] as ExpenseStatus[]) {
      expect(expenseCapabilities(expense({ status }), viewer(["SKATTMASTARE"])).canRemind).toBe(
        true,
      );
    }
  });

  it("is not offered on a draft of the viewer's own", () => {
    const own = expense({ status: "DRAFT", submitterId: "me" });
    expect(expenseCapabilities(own, viewer(["SKATTMASTARE"], "me")).canRemind).toBe(false);
  });

  it("is not offered once the utlägg is signed", () => {
    for (const status of ["APPROVED", "BOOKED", "EXPORTED"] as ExpenseStatus[]) {
      expect(expenseCapabilities(expense({ status }), viewer(["SKATTMASTARE"])).canRemind).toBe(
        false,
      );
    }
  });
});
