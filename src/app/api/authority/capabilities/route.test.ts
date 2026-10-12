import { beforeEach, describe, expect, it, vi } from "vitest";

// A route handler is an ordinary async function over a Request, so it can be
// tested like one. What stands in the way is not the handler. It is the two
// things underneath it that need a world: the session and the database. Both
// are replaced here at their lowest point, so everything above them is the real
// code: the real `gate`, the real zod schema, the real `fail`, and the real
// wiring between them.
//
// Worth doing here above anywhere else. This handler is the only way into the
// table every authority gate in the app reads, and the invariant it enforces,
// that somebody is always left who can open Inställningar, has no repair path
// short of hand-written SQL against production.

const h = vi.hoisted(() => ({
  tx: { roleCapability: { deleteMany: vi.fn(), createMany: vi.fn() } },
  canReachSettings: true,
  actorCapabilities: ["SETTINGS"] as string[],
}));

// The session, at the point `gate` asks who is acting. Mocked here rather than
// at `gate` itself so the authority check under test is the real one.
vi.mock("@/lib/server/current-user", () => ({
  resolveUserId: async () => "u1",
  loadUser: async () => ({
    name: "Skattmästaren",
    email: "skattm@dsek.se",
    studentId: "lu1234ge-s",
    roles: ["SKATTMASTARE"],
    capabilities: h.actorCapabilities,
  }),
}));

vi.mock("@/lib/server/tx", () => ({
  // The real one is serializable with a retry on write conflicts; what the
  // handler depends on is that the body runs and that throwing rolls it back.
  serializable: async (fn: (t: unknown) => Promise<unknown>) => fn(h.tx),
}));

vi.mock("@/lib/server/capabilities", () => ({
  someoneCanReachSettings: async () => h.canReachSettings,
}));

vi.mock("@/lib/server/db", () => ({ prisma: {} }));

const { PUT } = await import("./route");

const put = (body: unknown) =>
  PUT(
    new Request("http://test/api/authority/capabilities", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

beforeEach(() => {
  vi.clearAllMocks();
  h.canReachSettings = true;
  h.actorCapabilities = ["SETTINGS"];
});

describe("PUT /api/authority/capabilities", () => {
  it("replaces the role's whole set rather than applying a delta", async () => {
    // The grid sends finished state. The handler has to clear what was there
    // first, or unticking a box would never take anything away.
    const res = await put({ role: "SKATTMASTARE", capabilities: ["ADMIN", "SETTINGS"] });
    expect(res.status).toBe(204);
    expect(h.tx.roleCapability.deleteMany).toHaveBeenCalledWith({
      where: { role: "SKATTMASTARE" },
    });
    expect(h.tx.roleCapability.createMany).toHaveBeenCalledWith({
      data: [
        { role: "SKATTMASTARE", capability: "ADMIN" },
        { role: "SKATTMASTARE", capability: "SETTINGS" },
      ],
    });
  });

  it("writes no rows for a role stripped of everything, and still succeeds", async () => {
    // A role that may do nothing is a real state, and an empty grid row is what
    // it looks like, as long as somebody else can still open the door.
    const res = await put({ role: "STOCKARE", capabilities: [] });
    expect(res.status).toBe(204);
    expect(h.tx.roleCapability.deleteMany).toHaveBeenCalled();
    expect(h.tx.roleCapability.createMany).not.toHaveBeenCalled();
  });

  it("refuses a save that would leave nobody able to reach Inställningar", async () => {
    h.canReachSettings = false;
    const res = await put({ role: "SKATTMASTARE", capabilities: [] });
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ error: "authority.wouldLockOut" });
  });

  it("refuses a capability the code has no meaning for", async () => {
    // Checked at the edge: a value stored here would be one every gate in the
    // app silently ignores, and nothing downstream would ever say so.
    const res = await put({ role: "SKATTMASTARE", capabilities: ["BECOME_ROOT"] });
    expect(res.status).toBe(422);
    expect(h.tx.roleCapability.deleteMany).not.toHaveBeenCalled();
  });

  it("refuses a role the code has no meaning for", async () => {
    const res = await put({ role: "SUPERUSER", capabilities: [] });
    expect(res.status).toBe(422);
    expect(h.tx.roleCapability.deleteMany).not.toHaveBeenCalled();
  });

  it("does not touch the table for somebody who may not reach settings", async () => {
    h.actorCapabilities = ["BUDGET_VIEW"];
    const res = await put({ role: "SKATTMASTARE", capabilities: [] });
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ error: "auth.adminOnly" });
    expect(h.tx.roleCapability.deleteMany).not.toHaveBeenCalled();
  });
});
