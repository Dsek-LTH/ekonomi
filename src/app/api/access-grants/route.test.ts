import { beforeEach, describe, expect, it, vi } from "vitest";

// Session and database mocked at their lowest point, so the real gate, schema and period rule run.

const h = vi.hoisted(() => ({
  actorCapabilities: ["GRANT_ACCESS"] as string[],
  target: { active: true } as { active: boolean } | null,
  create: vi.fn(async () => ({ id: "g1" })),
  deleteMany: vi.fn(async () => ({ count: 0 })),
}));

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

vi.mock("@/lib/server/db", () => ({
  prisma: {
    user: { findUnique: async () => h.target },
    accessGrant: { create: h.create, deleteMany: h.deleteMany },
  },
}));

const { POST } = await import("./route");

const post = (body: unknown) =>
  POST(
    new Request("http://test/api/access-grants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

beforeEach(() => {
  vi.clearAllMocks();
  h.actorCapabilities = ["GRANT_ACCESS"];
  h.target = { active: true };
});

describe("POST /api/access-grants", () => {
  it("needs GRANT_ACCESS, and SETTINGS is not enough", async () => {
    h.actorCapabilities = ["SETTINGS", "ADMIN"];
    const res = await post({ userId: "u2", role: "STOCKARE" });
    expect(res.status).toBe(403);
    expect(h.create).not.toHaveBeenCalled();
  });

  it("gives a role from now until removed, recording who gave it", async () => {
    const res = await post({ userId: "u2", role: "STOCKARE" });
    expect(res.status).toBe(201);
    expect(h.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "u2",
        role: "STOCKARE",
        capability: null,
        validUntil: null,
        grantedById: "u1",
      }),
      select: { id: true },
    });
  });

  it("lets the giver give to themselves", async () => {
    const res = await post({ userId: "u1", capability: "ADMIN", until: "2099-01-01" });
    expect(res.status).toBe(201);
  });

  it("refuses both a role and a capability, and neither", async () => {
    expect((await post({ userId: "u2", role: "STOCKARE", capability: "ADMIN" })).status).toBe(422);
    expect((await post({ userId: "u2" })).status).toBe(422);
  });

  it("refuses the roles that cannot be granted", async () => {
    expect((await post({ userId: "u2", role: "RESULTATANSVARIG" })).status).toBe(422);
    expect((await post({ userId: "u2", role: "ORDINARIE" })).status).toBe(422);
  });

  it("refuses an end that has passed", async () => {
    const res = await post({ userId: "u2", role: "STOCKARE", until: "2000-01-01" });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "grant.endsInPast" });
  });

  it("refuses somebody who has never signed in, and somebody inactive", async () => {
    h.target = null;
    expect((await post({ userId: "nobody", role: "STOCKARE" })).status).toBe(404);
    h.target = { active: false };
    expect((await post({ userId: "u2", role: "STOCKARE" })).status).toBe(409);
  });
});
