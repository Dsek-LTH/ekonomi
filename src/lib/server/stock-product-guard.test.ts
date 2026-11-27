import { beforeEach, describe, expect, it, vi } from "vitest";

// Where the drink type is filed, it alone decides a product's group: the one linked to it, made on first use.

const h = vi.hoisted(() => ({
  linked: null as { id: string } | null,
  named: null as { id: string } | null,
  update: vi.fn(),
  create: vi.fn(async () => ({ id: "made" })),
}));

vi.mock("./db", () => ({
  prisma: {
    stockGroup: {
      findUnique: async () => h.linked,
      findFirst: async () => h.named,
      update: h.update,
      create: h.create,
    },
  },
}));

vi.mock("@/lib/api/guard", () => ({ fail: () => null }));

const { categoryGroup } = await import("./stock-product-guard");

beforeEach(() => {
  h.linked = null;
  h.named = null;
  h.update.mockClear();
  h.create.mockClear();
});

describe("categoryGroup", () => {
  it("is the group already linked to the drink type", async () => {
    h.linked = { id: "wine" };
    expect(await categoryGroup("alcohol", "VIN")).toBe("wine");
    expect(h.create).not.toHaveBeenCalled();
  });

  it("links a group of the drink type's name that is not linked yet", async () => {
    h.named = { id: "beer" };
    expect(await categoryGroup("alcohol", "OL")).toBe("beer");
    expect(h.update).toHaveBeenCalledWith({ where: { id: "beer" }, data: { category: "OL" } });
    expect(h.create).not.toHaveBeenCalled();
  });

  it("makes one, named and ordered as Folkhälsomyndigheten lists it", async () => {
    expect(await categoryGroup("alcohol", "SPRITDRYCK")).toBe("made");
    expect(h.create).toHaveBeenCalledWith({
      data: { stockId: "alcohol", name: "Spritdryck", category: "SPRITDRYCK", sortOrder: 3 },
      select: { id: true },
    });
  });
});
