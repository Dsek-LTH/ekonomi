import { beforeEach, describe, expect, it, vi } from "vitest";

// Moving a night to another day.
//
// Tested at the route because the part that matters is not the rename but what
// has to come with a new date: the rows booked on the night carry it as
// `occurredAt`, the log is read in that order, and a row left on the old day
// would be counted and priced as if the night had never moved.
//
// Mocked at the lowest layer, the way the entries test does it: the session and
// the database. The gate, the schema and the response are the real thing.

const h = vi.hoisted(() => ({
  capabilities: ["STOCK_MANAGE"] as string[],
  event: { id: "ev1" } as { id: string } | null,
  moved: 0,
  update: vi.fn(),
  updateMany: vi.fn(),
  replay: vi.fn(async () => 0),
  assertAllPossible: vi.fn(async () => {}),
}));

vi.mock("@/lib/server/current-user", () => ({
  resolveUserId: async () => "stockare",
  loadUser: async () => ({
    name: "Källarmästare",
    email: "k@dsek.se",
    studentId: "ka1234sm-s",
    roles: ["STOCKARE"],
    capabilities: h.capabilities,
  }),
}));

const tx = {
  stockEvent: { update: h.update },
  stockEntry: {
    updateMany: h.updateMany,
    findMany: async () => [{ productId: "p1" }, { productId: "p2" }],
  },
  stockProduct: {
    findMany: async () => [
      { id: "p1", kind: "UNIT", category: "OL", unitMl: 330, nominalMl: null },
      { id: "p2", kind: "UNIT", category: "OL", unitMl: 330, nominalMl: null },
    ],
  },
};

vi.mock("@/lib/server/db", () => ({
  prisma: { stockEvent: { findUnique: async () => h.event } },
}));
vi.mock("@/lib/server/tx", () => ({
  bulkTransaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx),
}));
vi.mock("@/lib/server/stock-replay", () => ({ replayProduct: h.replay }));
vi.mock("@/lib/server/stock-state", () => ({ assertAllPossible: h.assertAllPossible }));
vi.mock("@/lib/data/stock", () => ({ getStockEvent: async () => null }));

const { PATCH } = await import("./route");

const patch = (body: Record<string, unknown>) =>
  PATCH(
    new Request("http://test/api/stock/events/ev1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "ev1" }) },
  );

beforeEach(() => {
  h.capabilities = ["STOCK_MANAGE"];
  h.event = { id: "ev1" };
  h.moved = 0;
  h.update.mockReset().mockImplementation(async ({ data }: { data: { name: string; date: Date } }) => ({
    id: "ev1",
    name: data.name,
    date: data.date,
  }));
  h.updateMany.mockReset().mockImplementation(async () => ({ count: h.moved }));
  h.replay.mockClear();
  h.assertAllPossible.mockReset().mockResolvedValue(undefined);
});

describe("PATCH /api/stock/events/[id]", () => {
  it("moves the night's rows to the new date and replays every product it touched", async () => {
    h.moved = 3;
    const res = await patch({ name: "Fredagspub", date: "2026-03-14" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "ev1", name: "Fredagspub", date: "2026-03-14" });
    expect(h.updateMany).toHaveBeenCalledWith({
      where: { eventId: "ev1", occurredAt: { not: new Date("2026-03-14") } },
      data: { occurredAt: new Date("2026-03-14") },
    });
    expect(h.replay).toHaveBeenCalledTimes(2);
    expect(h.assertAllPossible).toHaveBeenCalledOnce();
  });

  it("replays nothing when no row had to move", async () => {
    const res = await patch({ name: "Fredagspub", date: "2026-03-14" });

    expect(res.status).toBe(200);
    expect(h.update).toHaveBeenCalledOnce();
    expect(h.replay).not.toHaveBeenCalled();
    expect(h.assertAllPossible).not.toHaveBeenCalled();
  });

  it("refuses a move that would leave stock negative", async () => {
    h.moved = 1;
    h.assertAllPossible.mockRejectedValue(new Error("stock.wouldGoNegative"));
    const res = await patch({ name: "Fredagspub", date: "2026-03-14" });

    expect(res.status).toBe(422);
  });

  it("answers 404 for a night that does not exist", async () => {
    h.event = null;
    const res = await patch({ name: "Fredagspub", date: "2026-03-14" });

    expect(res.status).toBe(404);
    expect(h.update).not.toHaveBeenCalled();
  });

  it("refuses somebody who may only read the stock", async () => {
    h.capabilities = ["STOCK_VIEW"];
    const res = await patch({ name: "Fredagspub", date: "2026-03-14" });

    expect(res.status).toBe(403);
    expect(h.update).not.toHaveBeenCalled();
  });

  it("refuses a date that is not a date", async () => {
    const res = await patch({ name: "Fredagspub", date: "fredag" });

    expect(res.status).toBe(422);
    expect(h.update).not.toHaveBeenCalled();
  });
});
