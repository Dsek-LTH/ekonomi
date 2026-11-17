import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/db", () => ({ prisma: {} }));

const { combine, holdingWhere, inForce } = await import("./access");

const MATRIX = new Map([
  ["STOCKARE", ["ALCOHOL_STOCK_VIEW", "ALCOHOL_STOCK_MANAGE"]],
  ["ORDINARIE", ["BUDGET_VIEW"]],
] as const) as unknown as Map<
  import("@/lib/domain/types").Role,
  import("@/lib/domain/types").Capability[]
>;

describe("combine", () => {
  it("is the groups' roles alone when nothing is granted", () => {
    expect(combine(MATRIX, ["ORDINARIE"], { roles: [], capabilities: [] })).toEqual({
      roles: ["ORDINARIE"],
      capabilities: ["BUDGET_VIEW"],
    });
  });

  it("adds a granted role and everything it may do", () => {
    const got = combine(MATRIX, ["ORDINARIE"], { roles: ["STOCKARE"], capabilities: [] });
    expect(got.roles).toEqual(["ORDINARIE", "STOCKARE"]);
    expect(got.capabilities.sort()).toEqual(
      ["ALCOHOL_STOCK_MANAGE", "ALCOHOL_STOCK_VIEW", "BUDGET_VIEW"].sort(),
    );
  });

  it("adds a granted capability without a role behind it", () => {
    const got = combine(MATRIX, ["ORDINARIE"], { roles: [], capabilities: ["SETTINGS"] });
    expect(got.roles).toEqual(["ORDINARIE"]);
    expect(got.capabilities).toContain("SETTINGS");
  });

  it("counts a role held twice once", () => {
    const got = combine(MATRIX, ["STOCKARE"], { roles: ["STOCKARE"], capabilities: [] });
    expect(got.roles).toEqual(["STOCKARE"]);
    expect(got.capabilities).toHaveLength(2);
  });
});

describe("inForce", () => {
  it("asks for started and not yet ended", () => {
    const now = new Date("2026-11-17T12:00:00Z");
    expect(inForce(now)).toEqual({
      validFrom: { lte: now },
      OR: [{ validUntil: null }, { validUntil: { gt: now } }],
    });
  });
});

describe("holdingWhere", () => {
  const now = new Date("2026-11-17T12:00:00Z");

  it("finds holders through a group and through a grant of the role or the capability", () => {
    expect(holdingWhere(["STYRELSE"], "BOARD_TAB", now)).toEqual({
      OR: [
        { roles: { hasSome: ["STYRELSE"] } },
        {
          accessGrants: {
            some: {
              AND: [
                inForce(now),
                { OR: [{ role: { in: ["STYRELSE"] } }, { capability: "BOARD_TAB" }] },
              ],
            },
          },
        },
      ],
    });
  });

  it("still finds a granted capability when no role holds it", () => {
    expect(holdingWhere([], "SETTINGS", now)).toEqual({
      OR: [
        {
          accessGrants: { some: { AND: [inForce(now), { OR: [{ capability: "SETTINGS" }] }] } },
        },
      ],
    });
  });
});
