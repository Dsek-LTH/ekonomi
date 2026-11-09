import { beforeEach, describe, expect, it, vi } from "vitest";

// Session and database are mocked at their lowest point, so the real `gate`, zod schema and `fail` run.
// The handler guards the lockout invariant (somebody must always be able to open Inställningar), which has no
// repair path short of SQL.

const h = vi.hoisted(() => ({
  tx: { roleCapability: { deleteMany: vi.fn(), createMany: vi.fn() } },
  canReachSettings: true,
  actorCapabilities: ["SETTINGS"] as string[],
}));

// Mocked at the session, not `gate`, so the real authority check runs.
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
  // The real one is serializable with write-conflict retries; the handler only needs the body to run and a throw to roll back.
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
    // The grid sends finished state, so the handler must clear what was there or unticking would never remove anything.
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
    // A role that may do nothing is a real state, as long as somebody else can still open Inställningar.
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
    // Checked at the edge: a stored value every gate silently ignores would never be reported.
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
