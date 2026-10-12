import { beforeEach, describe, expect, it, vi } from "vitest";

// Saving the gear catalogue, and the field it once dropped: the quantity. The
// schema accepted it and the dialog sent it, but neither route wrote it, so
// "Antal" came back as whatever the row already held. Availability is counted
// against that number, which makes it the one field here that must not be lost
// quietly.

const h = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  found: null as { id: string } | null,
}));

vi.mock("@/lib/server/current-user", () => ({
  resolveUserId: async () => "u1",
  loadUser: async () => ({
    name: "Uthyrningsansvarig",
    email: "u@dsek.se",
    studentId: "lu1234ab-s",
    roles: [],
    capabilities: ["RENTAL_MANAGE"],
  }),
}));

vi.mock("@/lib/server/db", () => ({
  prisma: {
    rentalItem: {
      // Looked up by name in the POST, which wants no clash, and by id in the
      // DELETE, which wants the row.
      findUnique: vi.fn(async ({ where }: { where: { id?: string } }) => (where.id ? h.found : null)),
      findFirst: vi.fn(async () => null),
      create: h.create,
      update: h.update,
      delete: h.delete,
    },
  },
}));

const { POST } = await import("./route");
const { PATCH, DELETE } = await import("./[id]/route");

const json = (url: string, method: string, body: unknown) =>
  new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  h.create.mockImplementation(async () => ({ id: "i1" }));
  h.update.mockImplementation(async () => ({ id: "i1" }));
  h.found = null;
});

describe("the gear catalogue routes", () => {
  it("stores the quantity a new item is added with", async () => {
    const res = await POST(
      json("http://test/api/rental-items", "POST", {
        name: "Soundboks",
        quantity: 4,
        replacementValueOre: 650_000,
      }),
    );
    expect(res.status).toBe(201);
    expect(h.create.mock.calls[0][0].data).toMatchObject({ name: "Soundboks", quantity: 4 });
  });

  it("stores a changed quantity alongside the other edits", async () => {
    const res = await PATCH(
      json("http://test/api/rental-items/i1", "PATCH", {
        name: "Soundboks",
        quantity: 6,
        dailyPriceOre: 25_000,
        replacementValueOre: 700_000,
        description: null,
      }),
      { params: Promise.resolve({ id: "i1" }) },
    );
    expect(res.status).toBe(204);
    expect(h.update).toHaveBeenCalledWith({
      where: { id: "i1" },
      data: {
        name: "Soundboks",
        quantity: 6,
        dailyPriceOre: 25_000,
        replacementValueOre: 700_000,
        description: null,
      },
      select: { id: true },
    });
  });

  it("deletes an item for real, even one a contract has quoted", async () => {
    // Nothing is retired any more. The contract keeps its own copy of the line.
    h.found = { id: "i1" };
    const res = await DELETE(new Request("http://test/api/rental-items/i1", { method: "DELETE" }), {
      params: Promise.resolve({ id: "i1" }),
    });
    expect(res.status).toBe(204);
    expect(h.delete).toHaveBeenCalledWith({ where: { id: "i1" } });
    expect(h.update).not.toHaveBeenCalled();
  });
});
