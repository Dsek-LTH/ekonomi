import { beforeEach, describe, expect, it, vi } from "vitest";

// Putting an utlägg's documents in order. The list has to be all of them,
// once each: a partial one would leave the rest wherever their old positions
// fall among the new, and the PDF Fortnox gets would come out shuffled.

const h = vi.hoisted(() => ({
  expense: null as null | { id: string; status: string; receipts: { id: string }[] },
  canEdit: true,
  update: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/server/current-user", () => ({
  resolveUserId: async () => "u1",
  loadUser: async () => ({
    name: "Funktionär",
    email: "f@dsek.se",
    studentId: "lu1234ab-s",
    roles: ["ORDINARIE"],
    capabilities: [],
  }),
}));

vi.mock("@/lib/api/expense-access", () => ({
  denyExpenseView: async () => null,
  canEditExpense: () => h.canEdit,
}));

vi.mock("@/lib/server/db", () => ({
  prisma: {
    expense: { findUnique: vi.fn(async () => h.expense) },
    receipt: { update: (args: unknown) => (h.update(args), args) },
    $transaction: async (ops: unknown[]) => (h.transaction(ops), ops),
  },
}));

const { PUT } = await import("./route");

const put = (ids: string[]) =>
  PUT(
    new Request("http://test/api/expenses/e1/receipts/order", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    }),
    { params: Promise.resolve({ id: "e1" }) },
  );

beforeEach(() => {
  h.expense = { id: "e1", status: "DRAFT", receipts: [{ id: "a" }, { id: "b" }, { id: "c" }] };
  h.canEdit = true;
  h.update.mockClear();
  h.transaction.mockClear();
});

describe("PUT /api/expenses/:id/receipts/order", () => {
  it("numbers the documents in the order given", async () => {
    const res = await put(["c", "a", "b"]);
    expect(res.status).toBe(204);
    expect(h.update.mock.calls.map(([a]) => a)).toEqual([
      { where: { id: "c" }, data: { position: 0 } },
      { where: { id: "a" }, data: { position: 1 } },
      { where: { id: "b" }, data: { position: 2 } },
    ]);
  });

  it.each([
    ["one missing", ["a", "b"]],
    ["one twice", ["a", "b", "b"]],
    ["one not this utlägg's", ["a", "b", "x"]],
  ])("refuses a list with %s", async (_, ids) => {
    const res = await put(ids);
    expect(res.status).toBe(422);
    expect(h.transaction).not.toHaveBeenCalled();
  });

  it("refuses once the utlägg can no longer be edited", async () => {
    h.expense!.status = "BOOKED";
    const res = await put(["a", "b", "c"]);
    expect(res.status).toBe(409);
    expect(h.transaction).not.toHaveBeenCalled();
  });

  it("refuses someone who may not edit it", async () => {
    h.canEdit = false;
    const res = await put(["a", "b", "c"]);
    expect(res.status).toBe(403);
  });
});
