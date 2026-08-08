import { describe, expect, it } from "vitest";
import { expenseCapabilities } from "./expense-capabilities";
import type { CostAllocation, Expense, ExpenseStatus, Role } from "./types";

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

const viewer = (roles: Role[], id = "someone-else") => ({ id, roles });

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
    // save — which is the same rule as `canEditExpense` on the server.
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

describe("deleting", () => {
  it("is the submitter's right until the utlägg is signed", () => {
    const draft = expense({ status: "DRAFT" });
    expect(expenseCapabilities(draft, viewer(["ORDINARIE"], "member")).canDelete).toBe(true);
  });

  it("stops being it once it is attested", () => {
    const approved = expense({ status: "APPROVED" });
    expect(expenseCapabilities(approved, viewer(["ORDINARIE"], "member")).canDelete).toBe(false);
  });

  it("remains an admin's at any point — it is the section's record", () => {
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
    // Nothing to submit yet — no receipt, no amount — but it is still theirs
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
