import { beforeEach, describe, expect, it, vi } from "vitest";

// A stocktake that should have been a delivery, made one. What matters: the
// purchase is what the count found more of, sealed only, priced from the
// product, and written to sort just before the count so the count then agrees.

const h = vi.hoisted(() => ({
  entry: null as null | { productId: string; kind: string; occurredAt: Date },
  product: null as null | { id: string; costPriceOre: number | null },
  day: [] as { level: number; units: number; createdAt: Date }[],
  created: vi.fn(),
  replayed: vi.fn(),
}));

vi.mock("@/lib/server/current-user", () => ({
  resolveUserId: async () => "u1",
  loadUser: async () => ({
    name: "Stockare",
    email: "s@dsek.se",
    studentId: "st1234ab-s",
    roles: ["SKATTMASTARE"],
    capabilities: ["STOCK_MANAGE", "STOCK_VIEW", "SETTINGS"],
  }),
}));

vi.mock("@/lib/domain/permissions", async (orig) => ({
  ...(await orig<typeof import("@/lib/domain/permissions")>()),
  canManageStock: () => true,
}));

vi.mock("@/lib/server/db", () => ({
  prisma: {
    stockEntry: {
      findUnique: async () => h.entry,
      findMany: async () => h.day,
    },
    stockProduct: { findUnique: async () => h.product },
  },
}));

vi.mock("@/lib/server/tx", () => ({
  bulkTransaction: async (fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      stockEntry: { create: async (args: unknown) => (h.created(args), { id: "p1" }) },
      stockChange: { create: async () => ({}) },
    }),
}));

vi.mock("@/lib/server/stock-replay", () => ({
  replayProduct: async (_tx: unknown, id: string) => h.replayed(id),
}));

const { POST } = await import("./route");
const post = () =>
  POST(new Request("http://test", { method: "POST" }), { params: Promise.resolve({ id: "c1" }) });

const day = new Date("2026-10-01T00:00:00Z");
const counted = new Date("2026-10-01T18:00:00Z");

beforeEach(() => {
  h.entry = { productId: "prod", kind: "COUNT", occurredAt: day };
  h.product = { id: "prod", costPriceOre: 26900 };
  h.day = [
    { level: 0, units: 6, createdAt: counted },
    { level: 60, units: 0, createdAt: counted },
  ];
  h.created.mockClear();
  h.replayed.mockClear();
});

describe("POST /api/stock/entries/:id/to-purchase", () => {
  it("books what the count found more of as a purchase, just before the count", async () => {
    const res = await post();
    expect(res.status).toBe(201);
    const { data } = h.created.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(data).toMatchObject({ kind: "PURCHASE", units: 6, unitCostOre: 26900, occurredAt: day });
    expect((data.createdAt as Date).getTime()).toBe(counted.getTime() - 1);
    expect(h.replayed).toHaveBeenCalledWith("prod");
  });

  it("refuses anything but a stocktake", async () => {
    h.entry!.kind = "PURCHASE";
    expect((await post()).status).toBe(422);
  });

  it("refuses a count that found nothing more", async () => {
    h.day = [{ level: 0, units: -2, createdAt: counted }];
    expect((await post()).status).toBe(422);
    expect(h.created).not.toHaveBeenCalled();
  });

  it("refuses a product with no cost price, which would value it at nothing again", async () => {
    h.product!.costPriceOre = null;
    expect((await post()).status).toBe(422);
  });
});
