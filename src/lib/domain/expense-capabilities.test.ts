import { describe, expect, it } from "vitest";
import { expenseCapabilities } from "./expense-capabilities";
import type { Capability, CostAllocation, Expense, ExpenseStatus, Role } from "./types";
import { DEFAULT_ROLE_CAPABILITIES } from "@/lib/server/authority-defaults";
import { today } from "./date";

// What the detail page offers, and to whom. This used to be derived in the
// browser from a hand-written second copy of the rules the API enforces; the
// copies had drifted, and nothing could tell, because neither side was tested
// against the other. It is one derivation now, on the server, and here.

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
  ...over,
});

// A viewer holding these roles, with the capabilities those roles have on the
// day the database is created (lib/server/authority-defaults.ts). Which roles
// carry which capability is editable now, so a case below saying "the ordförande
// cannot export" is a statement about the section's starting policy, which is
// exactly what it always was, when that policy was a list in permissions.ts.
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
  // The drift this file was written for. Exporting is a real Fortnox call made
  // under the bookkeeper's own login, and the roles that *have* such a login
  // are narrower than the roles with bookkeeping access in this app.
  const booked = expense({ status: "BOOKED" });

  it("is offered to the treasury, who can log in to Fortnox", () => {
    for (const role of ["SKATTMASTARE", "VICE_SKATTMASTARE", "SKATTFORMAN"] as Role[]) {
      expect(expenseCapabilities(booked, viewer([role])).canExport).toBe(true);
    }
  });

  it("is not offered to the ordförande, who cannot", () => {
    // They hold bookkeeping access and no Fortnox account. The button used to
    // be there, and its first step would have asked them to sign in to
    // something they have no way of signing in to.
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
    // Seeing an utlägg is not editing it. Offering "Redigera" here opened the
    // whole wizard on somebody else's claim, only for the PATCH to refuse the
    // save, which is the same rule as `canEditExpense` on the server.
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
    // `canAttest` is the one input the rules here do not re-derive: it is
    // stamped per allocation by the loader, which is the only side that knows
    // the viewer's result units.
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
    expect(expenseCapabilities(booked, viewer(["RESULTATANSVARIG"], "me")).canWithdrawAttest).toBe(false);
  });
});

describe("submitting a milersättning", () => {
  // The claim carries its journey rather than a receipt, so the receipt check
  // does not apply to it and the journey check has to. This was the hole:
  // `mileageBlocker` was never passed, so neither check ran and the detail page
  // offered "Skicka in" on a claim the transition route would refuse.
  //
  // Driven today, not on the shared fixture's March date: a milersättning is
  // out-of-pocket, so it has the 60-day filing deadline, which is a blocker of
  // its own and, rightly, reported ahead of anything else. These cases are
  // about the journey check, so the date is kept out of their way.

  // The route, which every case below fills in: these are about the readings
  // and the rate, and a missing route is its own blocker reported ahead of
  // both. It has a case of its own further down.
  const JOURNEY = { stops: ["Kårhuset, Lund", "Snabbgross", "Kårhuset, Lund"] };
  const mileage = (over: Partial<Expense> = {}) =>
    expense({
      paymentType: "MILEAGE",
      status: "DRAFT",
      submitterId: "member",
      purchaseDate: today(),
      mileage: { ...JOURNEY, odometerStart: 12300, odometerEnd: 12342, km: 42, orePerKm: 250 },
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
        mileage: { ...JOURNEY, odometerStart: 12300, odometerEnd: null, km: null, orePerKm: 250 },
      }),
      owner,
    );
    expect(can.submitBlocker).toBe("mileage");
    expect(can.canSubmit).toBe(false);
  });

  it("is refused while nothing has priced the day it was driven", () => {
    const can = expenseCapabilities(
      mileage({
        mileage: { ...JOURNEY, odometerStart: 12300, odometerEnd: 12342, km: 42, orePerKm: null },
      }),
      owner,
    );
    expect(can.submitBlocker).toBe("mileage");
  });

  it("is refused while the journey names fewer than two places", () => {
    // The claim is priceable and the readings make a journey, so everything
    // this used to look at is satisfied. What is missing is the half that says
    // the driving was the section's errand, which the transition route refuses
    // on. Offering "Skicka in" here would promise something the server will not
    // do, which is the failure the readings check was added to stop.
    const journey = { odometerStart: 12300, odometerEnd: 12342, km: 42, orePerKm: 250 };
    expect(
      expenseCapabilities(mileage({ mileage: { ...journey, stops: [] } }), owner).submitBlocker,
    ).toBe("mileage");
    expect(
      expenseCapabilities(mileage({ mileage: { ...journey, stops: ["Lund"] } }), owner)
        .submitBlocker,
    ).toBe("mileage");
    // Blank rows are not places, however many of them an editor left behind.
    expect(
      expenseCapabilities(mileage({ mileage: { ...journey, stops: ["Lund", "  ", ""] } }), owner)
        .submitBlocker,
    ).toBe("mileage");
  });

  it("is never asked for a receipt", () => {
    // The one thing a mileage claim must not be blocked on: it has no receipt
    // and is not meant to have one.
    expect(expenseCapabilities(mileage(), owner).submitBlocker).not.toBe("receipt");
  });

  it("still has the filing deadline over it", () => {
    // Out of the claimant's own pocket, so the same 60 days, and said ahead
    // of the journey check, since past the deadline there is nothing to fix.
    expect(expenseCapabilities(mileage({ purchaseDate: "2020-01-01" }), owner).submitBlocker).toBe(
      "tooLate",
    );
  });
});

describe("dispens från redovisningsfristen", () => {
  // The skattmästare letting one late eget utlägg be filed anyway. Three
  // conditions decide whether it is on offer, and each of them is the rule
  // rather than a convenience. See the dispens columns on Expense.
  const late = (over: Partial<Expense> = {}) =>
    expense({
      status: "DRAFT",
      submitterId: "member",
      paymentType: "REIMBURSEMENT",
      purchaseDate: "2020-01-01",
      // The underlag, so these cases are about the deadline rather than about
      // a missing receipt reported after it.
      receiptId: "r1",
      ...over,
    });
  const granted = {
    by: "Nora Lindqvist",
    at: "2026-03-05T10:00:00.000Z",
    reason: "Kvittot kom bort i flytten.",
  };

  it("is the skattmästare's, and nobody else's", () => {
    // ORDFORANDE is an admin here: full authority over other people's utlägg,
    // and still not this. The chair attests and edits; departing from a rule
    // the section set is the treasurer's, the same as locking a budget.
    expect(expenseCapabilities(late(), viewer(["SKATTMASTARE"])).canWaiveDeadline).toBe(true);
    expect(expenseCapabilities(late(), viewer(["ORDFORANDE"])).canWaiveDeadline).toBe(false);
    expect(expenseCapabilities(late(), viewer(["VICE_SKATTMASTARE"])).canWaiveDeadline).toBe(
      false,
    );
    expect(expenseCapabilities(late(), viewer(["ORDINARIE"], "member")).canWaiveDeadline).toBe(
      false,
    );
  });

  it("is offered only before the utlägg goes for attest", () => {
    // The deadline stops a late claim from *entering* the queue, so a dispens
    // given afterwards would be permitting what has already happened.
    const skattm = viewer(["SKATTMASTARE"]);
    for (const status of ["DRAFT", "PENDING_MATCH", "CHANGES_REQUESTED"] as ExpenseStatus[]) {
      expect(expenseCapabilities(late({ status }), skattm).canWaiveDeadline).toBe(true);
    }
    for (const status of ["PENDING_APPROVAL", "APPROVED", "BOOKED", "EXPORTED"] as ExpenseStatus[]) {
      expect(expenseCapabilities(late({ status }), skattm).canWaiveDeadline).toBe(false);
    }
  });

  it("is not offered on a claim that is in time", () => {
    // A dispens on the record has to mean something. One granted on a claim
    // nobody was stopping would leave a reason nobody can read back.
    const skattm = viewer(["SKATTMASTARE"]);
    expect(expenseCapabilities(late({ purchaseDate: today() }), skattm).canWaiveDeadline).toBe(
      false,
    );
    // Nor on a sektionskort purchase, however old: the money is already the
    // section's and the deadline was never over it.
    expect(
      expenseCapabilities(late({ paymentType: "CARD" }), skattm).canWaiveDeadline,
    ).toBe(false);
  });

  it("becomes the offer to take it back, once given", () => {
    const skattm = viewer(["SKATTMASTARE"]);
    const can = expenseCapabilities(late({ deadlineWaiver: granted }), skattm);
    expect(can.canWaiveDeadline).toBe(false);
    expect(can.canRevokeDeadlineWaiver).toBe(true);
    // And to nobody else, however senior.
    expect(
      expenseCapabilities(late({ deadlineWaiver: granted }), viewer(["ORDFORANDE"]))
        .canRevokeDeadlineWaiver,
    ).toBe(false);
  });

  it("lifts the deadline for the submitter, and lifts nothing else", () => {
    // The submitter never sees a button of their own here. What they see is the
    // block lifting, at the same moment everybody else does. Everything below
    // the deadline still has to be in order.
    const owner = viewer(["ORDINARIE"], "member");
    expect(expenseCapabilities(late(), owner).submitBlocker).toBe("tooLate");

    const waived = late({ deadlineWaiver: granted });
    expect(expenseCapabilities(waived, owner).submitBlocker).toBeNull();
    expect(expenseCapabilities(waived, owner).canSubmit).toBe(true);

    expect(
      expenseCapabilities({ ...waived, submitterHasPayout: false }, owner).submitBlocker,
    ).toBe("payout");
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
    const draft = expense({ status: "DRAFT", grossAmount: 0, receiptId: undefined });
    const can = expenseCapabilities(draft, viewer(["ORDINARIE"], "member"));
    // Nothing to submit yet (no receipt, no amount) but it is still theirs
    // to edit and to throw away.
    expect(can.hasPrimaryAction).toBe(false);
    expect(can.hasAnyAction).toBe(true);
  });
});

describe("statuses are covered, not assumed", () => {
  const all: ExpenseStatus[] = [
    "DRAFT",
    "PENDING_MATCH",
    "PENDING_APPROVAL",
    "CHANGES_REQUESTED",
    "APPROVED",
    "BOOKED",
    "EXPORTED",
  ];

  it("answers for every status without throwing", () => {
    // A cheap guard on the enum: a status added to the domain and forgotten
    // here shows up as a crash rather than as a quietly empty action panel.
    for (const status of all) {
      const can = expenseCapabilities(expense({ status }), viewer(["SKATTMASTARE"]));
      expect(typeof can.hasAnyAction).toBe("boolean");
    }
  });
});

describe("taking your own submission back", () => {
  // The submitter's counterpart to withdrawing an attest, and a different act:
  // that one takes back a signature, this takes back the claim. It exists for
  // the correction no attester can make on somebody's behalf: an eget utlägg
  // that turns out to have gone on the section card.
  const waiting = (over: Partial<Expense> = {}) =>
    expense({ status: "PENDING_APPROVAL", submitterId: "member", ...over });

  it("is offered to whoever submitted it", () => {
    expect(expenseCapabilities(waiting(), viewer([], "member")).canRecall).toBe(true);
  });

  it("is offered to an admin, who may act on their behalf", () => {
    // The same latitude they have to submit for somebody.
    expect(expenseCapabilities(waiting(), viewer(["SKATTMASTARE"], "other")).canRecall).toBe(true);
  });

  it("is not offered to anybody else", () => {
    // A resultatansvarig sees the utlägg and may attest it. Neither makes the
    // claim theirs to withdraw.
    expect(
      expenseCapabilities(waiting(), viewer(["RESULTATANSVARIG"], "other")).canRecall,
    ).toBe(false);
  });

  it("is not offered once it is actually attested", () => {
    // Somebody agreed to it; undoing that is bookkeeping's call, not the
    // submitter's. See `canReturn`.
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
    // The pair that makes the rule usable: editing is closed while somebody is
    // being asked to sign, and taking it back is what opens it again. Offering
    // neither would strand the submitter; offering both would let a claim
    // change under a reader.
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
    // A claim waiting for attest has no primary action for its own submitter,
    // without this the panel would have said there was nothing to do at all.
    const can = expenseCapabilities(waiting(), viewer([], "member"));
    expect(can.hasAnyAction).toBe(true);
  });
});
