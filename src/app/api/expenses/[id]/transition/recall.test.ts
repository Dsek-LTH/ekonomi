import { beforeEach, describe, expect, it, vi } from "vitest";

// Taking your own utlägg back out of the attest queue.
//
// Tested at the route rather than only through `canRecall`, because the two
// things that make it safe are here and nowhere else: who is allowed to do it,
// and that every signature already given is cleared on the way out. An attest
// is a statement about the claim as it stood: "this 420 kr was spent
// privately", and this action exists to change what it stood for. A signature
// that survived would be a name against a claim that no longer says what was
// signed.
//
// Mocked at the lowest layer: the session and the database. Everything above
// them is the real thing: the real gate, the real schema, the real status
// rules, the real response.

const h = vi.hoisted(() => ({
  status: "PENDING_APPROVAL" as string,
  submitterId: "member",
  actorId: "member",
  capabilities: [] as string[],
  approvals: vi.fn(),
  update: vi.fn(),
  event: vi.fn(),
  notify: vi.fn(),
}));

vi.mock("@/lib/server/current-user", () => ({
  resolveUserId: async () => h.actorId,
  loadUser: async () => ({
    name: "Medlem",
    email: "m@dsek.se",
    studentId: "me1234dl-s",
    roles: ["ORDINARIE"],
    capabilities: h.capabilities,
  }),
}));

vi.mock("@/lib/server/db", () => ({
  prisma: {
    expense: {
      findUnique: async () => ({
        id: "e1",
        status: h.status,
        submitterId: h.submitterId,
        reference: "DEK26-0042",
        paymentType: "REIMBURSEMENT",
        title: "Kolsyra",
        purchaseDate: new Date("2026-03-01"),
        grossAmount: 45000,
        matchedTransactionId: null,
        matchedTransaction: null,
        receipts: [{ id: "r1" }],
        allocations: [
          { id: "a1", approvedById: "chief", costCenter: { code: "SEX01" }, amount: 45000 },
        ],
        submitter: { roles: ["ORDINARIE"], bankClearingNumber: "8327", bankAccountNumber: "123" },
      }),
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        expenseCostAllocation: { updateMany: h.approvals },
        expense: { updateMany: h.update },
        expenseEvent: { create: h.event },
      }),
  },
}));

// Scope and ownership are their own modules with their own tests; what matters
// here is that this utlägg is visible and the actor owns no result unit.
vi.mock("@/lib/api/expense-access", () => ({ denyExpenseView: async () => null }));
vi.mock("@/lib/server/result-units", () => ({
  ownedResultUnits: async () => ({ names: [] as string[] }),
  getPrefixes: async () => [],
  resultUnitNameForCode: () => null,
}));

// Who gets mailed is notify's own business, tested there. What matters here is
// that the recall asks for the right mail, from inside its transaction.
vi.mock("@/lib/server/notify", () => ({
  attestersOf: async () => ["chief"],
  holdersOf: async () => [],
  notify: h.notify,
  deliverSoon: () => {},
}));

const { POST } = await import("./route");

const recall = () =>
  POST(
    new Request("http://test/api/expenses/e1/transition", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "recall" }),
    }),
    { params: Promise.resolve({ id: "e1" }) },
  );

beforeEach(() => {
  vi.clearAllMocks();
  h.status = "PENDING_APPROVAL";
  h.submitterId = "member";
  h.actorId = "member";
  h.capabilities = [];
  h.approvals.mockResolvedValue({ count: 1 });
  h.update.mockResolvedValue({ count: 1 });
  h.event.mockResolvedValue({});
});

describe("POST /api/expenses/[id]/transition: recall", () => {
  it("puts a waiting utlägg back in the submitter's hands as a draft", async () => {
    const res = await recall();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ status: "DRAFT" });
    expect(h.update).toHaveBeenCalledWith({
      // Conditional on the status it was read at, so an attest landing in the
      // meantime is not quietly overwritten.
      where: { id: "e1", status: "PENDING_APPROVAL" },
      data: { status: "DRAFT" },
    });
  });

  it("clears every signature already given", async () => {
    await recall();
    expect(h.approvals).toHaveBeenCalledWith({
      where: { expenseId: "e1", approvedById: { not: null } },
      data: { approvedById: null, approvedAt: null },
    });
  });

  it("writes its own event rather than borrowing another's", async () => {
    // The timeline has to say what happened: nobody requested a change here.
    await recall();
    expect(h.event).toHaveBeenCalledWith({
      data: { expenseId: "e1", type: "RECALLED", actorId: "member", comment: null },
    });
  });

  it("tells whoever was asked to attest it, but not the one recalling", async () => {
    await recall();
    expect(h.notify).toHaveBeenCalledWith(
      expect.anything(),
      "EXPENSE_RECALLED",
      ["chief"],
      expect.objectContaining({ subject: "Tillbakadraget: DEK26-0042 - Kolsyra" }),
      { exclude: ["member"] },
    );
  });

  it("never touches the reference", async () => {
    // The same claim keeps the same number across a correction, rather than
    // burning a second one out of the year's sequence.
    await recall();
    for (const call of h.update.mock.calls) {
      expect(call[0].data).not.toHaveProperty("reference");
    }
  });

  it("is refused to anybody but the submitter", async () => {
    h.actorId = "someone-else";
    const res = await recall();
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ error: "expense.noRecallAccess" });
    expect(h.approvals).not.toHaveBeenCalled();
  });

  it("is allowed to an admin on the submitter's behalf", async () => {
    h.actorId = "treasurer";
    h.capabilities = ["ADMIN"];
    expect((await recall()).status).toBe(200);
  });

  it("is refused once the utlägg is actually attested", async () => {
    // Somebody agreed to it, and unwinding that is bookkeeping's call.
    for (const status of ["APPROVED", "BOOKED", "EXPORTED"]) {
      h.status = status;
      const res = await recall();
      expect(res.status).toBe(409);
      await expect(res.json()).resolves.toMatchObject({
        error: "expense.recallAfterApproved",
      });
    }
    expect(h.update).not.toHaveBeenCalled();
  });

  it("says there is nothing to take back from one already in hand", async () => {
    for (const status of ["DRAFT", "CHANGES_REQUESTED"]) {
      h.status = status;
      const res = await recall();
      expect(res.status).toBe(409);
      await expect(res.json()).resolves.toMatchObject({ error: "expense.nothingToRecall" });
    }
    expect(h.update).not.toHaveBeenCalled();
  });

  it("answers 409 rather than 500 when the status moved under it", async () => {
    // Somebody attested the last row between the read and the write.
    h.update.mockResolvedValue({ count: 0 });
    expect((await recall()).status).toBe(409);
  });
});
