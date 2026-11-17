import { beforeEach, describe, expect, it, vi } from "vitest";

// Who answers for a result unit is set on the unit. Session and database are mocked at their lowest point, so the
// real gate, schema and group check run.

const h = vi.hoisted(() => ({
  capabilities: ["SETTINGS"] as string[],
  unit: { id: "ru1" } as { id: string } | null,
  tx: {
    groupResultUnit: { deleteMany: vi.fn(), createMany: vi.fn() },
  },
}));

vi.mock("@/lib/server/current-user", () => ({
  resolveUserId: async () => "u1",
  loadUser: async () => ({
    name: "Skattmästaren",
    email: "s@dsek.se",
    studentId: "lu1234ge-s",
    roles: ["SKATTMASTARE"],
    capabilities: h.capabilities,
  }),
}));

vi.mock("@/lib/server/db", () => ({
  prisma: { resultUnit: { findUnique: async () => h.unit } },
}));

vi.mock("@/lib/server/authority-change", () => ({
  changeAuthority: async (fn: (tx: unknown) => Promise<unknown>) => ({
    ok: true,
    value: await fn(h.tx),
  }),
}));

vi.mock("@/lib/server/authentik-roles", () => ({ reapplyGrants: async () => 3 }));

const { PUT } = await import("./route");

const put = (groups: unknown) =>
  PUT(
    new Request("http://test/api/result-units/ru1/groups", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ groups }),
    }),
    { params: Promise.resolve({ id: "ru1" }) },
  );

beforeEach(() => {
  vi.clearAllMocks();
  h.capabilities = ["SETTINGS"];
  h.unit = { id: "ru1" };
});

describe("PUT /api/result-units/[id]/groups", () => {
  it("replaces the unit's groups, lower-cased and once each, and re-derives who holds them", async () => {
    const res = await put(["DSEK.Sex.Mastare", "dsek.sex.mastare", "dsek.sex.vice_mastare"]);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ affected: 3 });
    expect(h.tx.groupResultUnit.deleteMany).toHaveBeenCalledWith({
      where: { resultUnitId: "ru1" },
    });
    expect(h.tx.groupResultUnit.createMany).toHaveBeenCalledWith({
      data: [
        { group: "dsek.sex.mastare", resultUnitId: "ru1" },
        { group: "dsek.sex.vice_mastare", resultUnitId: "ru1" },
      ],
    });
  });

  it("clears the unit's groups with an empty list", async () => {
    expect((await put([])).status).toBe(200);
    expect(h.tx.groupResultUnit.createMany).not.toHaveBeenCalled();
  });

  it("refuses a group outside the section", async () => {
    const res = await put(["dchip.ordf"]);
    expect(res.status).toBe(422);
    expect(h.tx.groupResultUnit.deleteMany).not.toHaveBeenCalled();
  });

  it("refuses a unit that does not exist, and anybody without SETTINGS", async () => {
    h.unit = null;
    expect((await put(["dsek.sex.mastare"])).status).toBe(404);
    h.unit = { id: "ru1" };
    h.capabilities = ["GRANT_ACCESS"];
    expect((await put(["dsek.sex.mastare"])).status).toBe(403);
  });
});
