import { beforeEach, describe, expect, it, vi } from "vitest";

// Attesting some of an utlägg's rows rather than all of them.
//
// The skattmästare may sign any row, so "Attestera" used to sign every row on
// the utlägg at once, including units somebody else answers for. With
// `allocationIds` it signs only the picked ones. Left out, it signs every row
// the caller may, as before.
//
// Mocked at the session and the database, like recall.test.ts.

const h = vi.hoisted(() => ({
  allocations: [] as {
    id: string;
    approvedById: string | null;
    costCenter: { code: string; name: string };
  }[],
  approvals: vi.fn(),
  count: vi.fn(),
  update: vi.fn(),
  event: vi.fn(),
  notify: vi.fn(),
}));

vi.mock("@/lib/server/current-user", () => ({
  resolveUserId: async () => "treasurer",
  loadUser: async () => ({
    name: "Skattmästare",
    email: "s@dsek.se",
    studentId: "sk1234tt-s",
    roles: ["SKATTMASTARE"],
    capabilities: ["ADMIN"],
  }),
}));

vi.mock("@/lib/server/db", () => ({
  prisma: {
    expense: {
      findUnique: async () => ({
        id: "e1",
        status: "PENDING_APPROVAL",
        submitterId: "member",
        reference: "DEK26-0042",
        paymentType: "REIMBURSEMENT",
        title: "Kolsyra",
        purchaseDate: new Date("2026-03-01"),
        grossAmount: 45000,
        matchedTransactionId: null,
        matchedTransaction: null,
        receipts: [{ id: "r1" }],
        allocations: h.allocations,
        submitter: { name: "Medlem", roles: ["ORDINARIE"] },
      }),
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        expenseCostAllocation: { updateMany: h.approvals, count: h.count },
        expense: { updateMany: h.update },
        expenseEvent: { create: h.event },
      }),
  },
}));

vi.mock("@/lib/api/expense-access", () => ({ denyExpenseView: async () => null }));
vi.mock("@/lib/server/result-units", () => ({
  ownedResultUnits: async () => ({ names: [] as string[] }),
  getPrefixes: async () => [],
  resultUnitNameForCode: () => null,
}));
vi.mock("@/lib/server/notify", () => ({
  attestersOf: async () => [],
  holdersOf: async () => [],
  notify: h.notify,
  deliverSoon: () => {},
}));

const { POST } = await import("./route");

const approve = (allocationIds?: string[]) =>
  POST(
    new Request("http://test/api/expenses/e1/transition", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "approve", allocationIds }),
    }),
    { params: Promise.resolve({ id: "e1" }) },
  );

const row = (id: string, approvedById: string | null = null) => ({
  id,
  approvedById,
  costCenter: { code: id.toUpperCase(), name: id },
});

beforeEach(() => {
  vi.clearAllMocks();
  h.allocations = [row("sex"), row("info")];
  h.approvals.mockImplementation(async ({ where }) => ({ count: where.id.in.length }));
  h.count.mockResolvedValue(1);
  h.update.mockResolvedValue({ count: 1 });
  h.event.mockResolvedValue({});
});

describe("POST /api/expenses/[id]/transition: approve", () => {
  it("signs every row the caller may when none are picked", async () => {
    h.count.mockResolvedValue(0);
    const res = await approve();
    expect(res.status).toBe(200);
    expect(h.approvals.mock.calls[0][0].where.id.in).toEqual(["sex", "info"]);
    await expect(res.json()).resolves.toMatchObject({ status: "APPROVED" });
  });

  it("signs only the picked row and leaves the utlägg waiting", async () => {
    const res = await approve(["sex"]);
    expect(res.status).toBe(200);
    expect(h.approvals.mock.calls[0][0].where.id.in).toEqual(["sex"]);
    await expect(res.json()).resolves.toMatchObject({ status: "PENDING_APPROVAL" });
    expect(h.update).not.toHaveBeenCalled();
  });

  it("refuses a picked row somebody else signed in the meantime", async () => {
    h.allocations = [row("sex", "chief"), row("info")];
    const res = await approve(["sex"]);
    expect(res.status).toBe(409);
    expect(h.approvals).not.toHaveBeenCalled();
  });

  it("refuses a picked row that is not on the utlägg", async () => {
    const res = await approve(["sex", "elsewhere"]);
    expect(res.status).toBe(403);
    expect(h.approvals).not.toHaveBeenCalled();
  });
});

const withdraw = (allocationIds?: string[]) =>
  POST(
    new Request("http://test/api/expenses/e1/transition", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "withdraw_attest", allocationIds }),
    }),
    { params: Promise.resolve({ id: "e1" }) },
  );

describe("POST /api/expenses/[id]/transition: withdraw_attest", () => {
  it("takes back only the picked signature", async () => {
    h.allocations = [row("sex", "treasurer"), row("info", "treasurer")];
    const res = await withdraw(["sex"]);
    expect(res.status).toBe(200);
    expect(h.approvals.mock.calls[0][0].where.id.in).toEqual(["sex"]);
  });

  it("takes back every signature of the caller's when none are picked", async () => {
    h.allocations = [row("sex", "treasurer"), row("info", "treasurer")];
    await withdraw();
    expect(h.approvals.mock.calls[0][0].where.id.in).toEqual(["sex", "info"]);
  });

  it("refuses a picked row somebody else signed", async () => {
    h.allocations = [row("sex", "treasurer"), row("info", "chief")];
    const res = await withdraw(["info"]);
    expect(res.status).toBe(403);
    expect(h.approvals).not.toHaveBeenCalled();
  });
});
