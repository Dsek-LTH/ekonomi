import { beforeEach, describe, expect, it, vi } from "vitest";

// Ticking a bokslut checklist item, and writing its notes.
//
// Pinned: an item the app answers by itself cannot be ticked by hand, an item
// is only reachable through its own year, and only whoever works the books
// may write. Mocked at the session and the database.

const h = vi.hoisted(() => ({
  capabilities: ["BOOKKEEPING"] as string[],
  item: { financialYear: 1, check: null as string | null } as {
    financialYear: number;
    check: string | null;
  } | null,
  update: vi.fn(),
}));

vi.mock("@/lib/server/current-user", () => ({
  resolveUserId: async () => "u4",
  loadUser: async () => ({
    name: "Maja Holm",
    email: "m@dsek.se",
    studentId: "ma3456ho-s",
    roles: ["SKATTMASTARE"],
    capabilities: h.capabilities,
  }),
}));

vi.mock("@/lib/server/db", () => ({
  prisma: {
    checklistItem: { findUnique: async () => h.item, update: h.update },
  },
}));

const { PATCH } = await import("./route");

const send = (body: unknown, year = "1") =>
  PATCH(
    new Request("http://test/api/closing/1/checklist/i1", {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ year, item: "i1" }) },
  );

beforeEach(() => {
  vi.clearAllMocks();
  h.capabilities = ["BOOKKEEPING"];
  h.item = { financialYear: 1, check: null };
  h.update.mockResolvedValue({});
});

describe("PATCH /api/closing/[year]/checklist/[item]", () => {
  it("ticks an item by hand, recording who", async () => {
    expect((await send({ done: true })).status).toBe(204);
    expect(h.update).toHaveBeenCalledWith({
      where: { id: "i1" },
      data: { doneAt: expect.any(Date), doneById: "u4" },
    });
  });

  it("unticks it, clearing who", async () => {
    await send({ done: false });
    expect(h.update).toHaveBeenCalledWith({
      where: { id: "i1" },
      data: { doneAt: null, doneById: null },
    });
  });

  it("writes only the notes it was sent", async () => {
    await send({ noteToNextYear: "  Beställ Swish-rapporten i god tid.  " });
    expect(h.update).toHaveBeenCalledWith({
      where: { id: "i1" },
      data: { noteToNextYear: "Beställ Swish-rapporten i god tid." },
    });
  });

  it("refuses a tick on an item the app answers by itself", async () => {
    h.item = { financialYear: 1, check: "EXPENSES_EXPORTED" };
    const res = await send({ done: true });
    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toMatchObject({ error: "closing.itemHasCheck" });
    expect(h.update).not.toHaveBeenCalled();
  });

  it("still takes notes on such an item", async () => {
    h.item = { financialYear: 1, check: "EXPENSES_EXPORTED" };
    expect((await send({ note: "Tre sena utlägg från nollningen." })).status).toBe(204);
  });

  it("is a 404 for an item belonging to another year", async () => {
    expect((await send({ done: true }, "2")).status).toBe(404);
    expect(h.update).not.toHaveBeenCalled();
  });

  it("refuses a revisor, who reads the checklist and does not tick it", async () => {
    h.capabilities = ["BOOKKEEPING_VIEW", "AUDIT_REVIEW"];
    expect((await send({ done: true })).status).toBe(403);
    expect(h.update).not.toHaveBeenCalled();
  });
});
