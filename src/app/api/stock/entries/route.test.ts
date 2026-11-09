import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  capabilities: ["STOCK_MANAGE"] as string[],
  /** What the log says the shelf holds, as a summed row. */
  sums: {
    units: 0,
    open80: 0,
    open60: 0,
    open40: 0,
    open20: 0,
    valueDeltaOre: 0,
  } as Record<string, number>,
  product: {
    id: "p1",
    kind: "UNIT" as string,
    category: "OL" as string,
    unitMl: 330,
    nominalMl: null as number | null,
    costPriceOre: 1200,
    shelfLifeMonths: 9,
  },
  create: vi.fn(),
  change: vi.fn(),
  createManyAndReturn: vi.fn(),
  createMany: vi.fn(),
  event: vi.fn(),
  /** What the night has already moved of this product, as stored rows. */
  booked: [] as Record<string, unknown>[],
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

const entryTable = {
  aggregate: async () => ({ _sum: h.sums }),
  findMany: async () => h.booked,
  findUnique: async () => null,
  create: h.create,
  createManyAndReturn: h.createManyAndReturn,
};

vi.mock("@/lib/server/db", () => ({
  prisma: {
    stockProduct: { findUnique: async () => h.product },
    stockEntry: entryTable,
    // The non-stocktake path writes its change row outside the transaction.
    stockChange: { create: h.change, createMany: h.createMany },
    stockEvent: { findUnique: async () => ({ id: "ev1" }) },
    expense: { findUnique: async () => ({ id: "x1" }) },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        stockEntry: entryTable,
        stockChange: { create: h.change, createMany: h.createMany },
      }),
  },
}));

const replay = vi.fn(async () => 0);
vi.mock("@/lib/server/stock-replay", () => ({ replayProduct: replay }));

// The list read back by GET, irrelevant to every case here.
vi.mock("@/lib/data/stock", () => ({ getStockLog: async () => [] }));

const { POST } = await import("./route");

type Body = Record<string, unknown>;

const post = (body: Body) =>
  POST(
    new Request("http://test/api/stock/entries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

/** A delivery of `units` cans, which is the simplest thing this route writes. */
const delivery = (over: Body = {}): Body => ({
  productId: "p1",
  kind: "PURCHASE",
  occurredAt: "2026-09-01",
  units: 24,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  h.capabilities = ["STOCK_MANAGE"];
  h.sums = { units: 0, open80: 0, open60: 0, open40: 0, open20: 0, valueDeltaOre: 0 };
  h.product = {
    id: "p1",
    kind: "UNIT",
    category: "OL",
    unitMl: 330,
    nominalMl: null,
    costPriceOre: 1200,
    shelfLifeMonths: 9,
  };
  h.create.mockResolvedValue({ id: "e1" });
  h.change.mockResolvedValue({});
  h.createManyAndReturn.mockResolvedValue([{ id: "e1" }]);
  h.createMany.mockResolvedValue({ count: 1 });
  h.booked = [];
});

/** A night's checkout of `units` sealed cans, as the log stores it. */
const checkedOut = (units: number) => ({
  kind: "CHECKOUT",
  units: -units,
  open80: 0,
  open60: 0,
  open40: 0,
  open20: 0,
  spilledQty: 0,
  level: 0,
});

describe("POST /api/stock/entries", () => {
  it("refuses anybody without STOCK_MANAGE", async () => {
    h.capabilities = ["STOCK_VIEW"];
    const res = await post(delivery());
    expect(res.status).toBe(403);
    expect(h.create).not.toHaveBeenCalled();
  });

  it("books a delivery and prices it at what the product costs today", async () => {
    const res = await post(delivery({ units: 24 }));
    expect(res.status).toBe(201);
    const data = h.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ productId: "p1", kind: "PURCHASE", units: 24 });
    expect(data.valueDeltaOre).toBe(24 * 1200);
    expect(data.unitCostOre).toBe(1200);
    // A delivery is the one kind that arrives with an age.
    expect(data.bestBefore).toEqual(new Date("2027-06-01"));
    expect(replay).toHaveBeenCalledWith(expect.anything(), "p1");
  });

  it("will not take out stock that is not there", async () => {
    // The shelf holds four; a night wants six.
    h.sums = { ...h.sums, units: 4 };
    const res = await post(delivery({ kind: "CHECKOUT", units: -6, eventId: "ev1" }));
    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toMatchObject({ error: "stock.notThatManySealed" });
    expect(h.create).not.toHaveBeenCalled();
  });

  it("takes out what is there", async () => {
    h.sums = { ...h.sums, units: 24, valueDeltaOre: 24 * 1200 };
    const res = await post(delivery({ kind: "CHECKOUT", units: -6, eventId: "ev1" }));
    expect(res.status).toBe(201);
    expect(h.create.mock.calls[0][0].data.valueDeltaOre).toBe(-6 * 1200);
  });

  it("makes a night's movements name their night", async () => {
    // A checkout belonging to no event is a row nothing can reconcile.
    for (const kind of ["CHECKOUT", "RETURN", "WASTE"]) {
      h.sums = { ...h.sums, units: 24 };
      const res = await post(delivery({ kind, units: -1, spilledQty: 1 }));
      expect(res.status).toBe(422);
      await expect(res.json()).resolves.toMatchObject({ error: "stock.eventRequired" });
    }
    expect(h.create).not.toHaveBeenCalled();
  });

  it("keeps the cellar's own kinds off a night", async () => {
    const res = await post(delivery({ kind: "SPOILAGE", units: -1, eventId: "ev1" }));
    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toMatchObject({ error: "stock.eventOnNightOnly" });
    expect(h.create).not.toHaveBeenCalled();
  });

  it("refuses a delivery that takes stock away", async () => {
    // A kind and a sign that disagree is a row nobody can read later.
    const res = await post(delivery({ units: -24 }));
    expect(res.status).toBe(422);
    expect(h.create).not.toHaveBeenCalled();
  });

  it("answers 404 for a product that is not there", async () => {
    h.product = null as unknown as typeof h.product;
    const res = await post(delivery());
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ error: "stock.productNotFound" });
  });

  describe("a spill", () => {
    it("records what was dropped and moves no stock", async () => {
      h.booked = [checkedOut(6)];
      const res = await post(delivery({ kind: "WASTE", units: 0, spilledQty: 2, eventId: "ev1" }));
      expect(res.status).toBe(201);
      const data = h.create.mock.calls[0][0].data;
      expect(data).toMatchObject({
        kind: "WASTE",
        units: 0,
        spilledQty: 2,
        open80: 0,
        open20: 0,
      });
      // The feed logs the figure somebody typed, which on a spill is its own.
      expect(h.change.mock.calls[0][0].data.toQty).toBe(2);
    });

    it("refuses more than the night still has out", async () => {
      h.booked = [checkedOut(1)];
      const res = await post(delivery({ kind: "WASTE", units: 0, spilledQty: 2, eventId: "ev1" }));
      expect(res.status).toBe(422);
      await expect(res.json()).resolves.toMatchObject({ error: "stock.moreThanWentOut" });
      expect(h.create).not.toHaveBeenCalled();
    });

    it("refuses a spill of nothing", async () => {
      h.booked = [checkedOut(6)];
      const res = await post(delivery({ kind: "WASTE", units: 0, spilledQty: 0, eventId: "ev1" }));
      expect(res.status).toBe(422);
      await expect(res.json()).resolves.toMatchObject({ error: "stock.nothingSpilled" });
    });
  });

  describe("a return", () => {
    it("brings back what the night still has out", async () => {
      h.booked = [checkedOut(6)];
      const res = await post(delivery({ kind: "RETURN", units: 4, eventId: "ev1" }));
      expect(res.status).toBe(201);
      expect(h.create.mock.calls[0][0].data).toMatchObject({ kind: "RETURN", units: 4 });
    });

    it("refuses to bring back more than went out", async () => {
      h.booked = [checkedOut(6)];
      const res = await post(delivery({ kind: "RETURN", units: 7, eventId: "ev1" }));
      expect(res.status).toBe(422);
      await expect(res.json()).resolves.toMatchObject({ error: "stock.moreThanWentOut" });
      expect(h.create).not.toHaveBeenCalled();
    });
  });

  describe("a stocktake", () => {
    it("writes the counted figure per rung, in one statement", async () => {
      const res = await post({
        productId: "p1",
        kind: "COUNT",
        occurredAt: "2026-09-01",
        counted: { sealed: 18 },
      });
      expect(res.status).toBe(201);
      expect(h.createManyAndReturn).toHaveBeenCalledTimes(1);
      const rows = h.createManyAndReturn.mock.calls[0][0].data;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ kind: "COUNT", level: 0, countedQty: 18 });
      expect(replay).toHaveBeenCalledWith(expect.anything(), "p1");
    });

    it("writes a rung per level for a product counted by volume", async () => {
      h.product = { ...h.product, kind: "VOLUME", unitMl: 700, nominalMl: 700 };
      const res = await post({
        productId: "p1",
        kind: "COUNT",
        occurredAt: "2026-09-01",
        counted: { sealed: 3, open: { "80": 1, "40": 2 } },
      });
      expect(res.status).toBe(201);
      const rows = h.createManyAndReturn.mock.calls[0][0].data;
      expect(rows.map((r: { level: number }) => r.level)).toEqual([0, 80, 60, 40, 20]);
      expect(rows.map((r: { countedQty: number }) => r.countedQty)).toEqual([3, 1, 0, 2, 0]);
      // One change row per entry, paired by position.
      expect(h.createMany).toHaveBeenCalledTimes(1);
    });

    it("refuses a counted figure on anything but a stocktake", async () => {
      const res = await post(delivery({ counted: { sealed: 4 } }));
      expect(res.status).toBe(422);
      await expect(res.json()).resolves.toMatchObject({
        error: "stock.countedOnStocktakeOnly",
      });
    });
  });
});
