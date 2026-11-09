import { describe, expect, it } from "vitest";
import { DEFAULT_GROUP_RESULT_UNITS, DEFAULT_GROUP_ROLES } from "./authority-defaults";
import {
  buildMapping,
  deriveGrants,
  explainGrants,
  reapplyGrants,
  sectionGroups,
} from "./authentik-roles";

// Two things a unit test can know: the derivation (group list to roles and result units) and the defaults
// (the state the section starts from, where each policy decision is written down).
const DEFAULTS = buildMapping(DEFAULT_GROUP_ROLES, DEFAULT_GROUP_RESULT_UNITS);

const grants = (groups: string[] | undefined) => deriveGrants(DEFAULTS, groups);
const roles = (groups: string[]) => grants(groups).roles;
const units = (groups: string[]) => grants(groups).resultUnits;

describe("deriveGrants", () => {
  it("gives everyone the baseline role and nothing else", () => {
    expect(grants([])).toEqual({ roles: ["ORDINARIE"], resultUnits: [] });
    expect(grants(undefined)).toEqual({ roles: ["ORDINARIE"], resultUnits: [] });
  });

  it("ignores groups that mean nothing here", () => {
    expect(roles(["authentik Admins", "dsek.medlem", "dchip.ordf"])).toEqual(["ORDINARIE"]);
  });

  it("ignores a retired mandate", () => {
    // Upstream prefixes historic positions `old.`, which puts them outside the section test.
    expect(roles(["old.dsek.infu.mastare"])).toEqual(["ORDINARIE"]);
  });

  it("matches the whole group name, not a part of it", () => {
    expect(roles(["dsek.cafe"])).toEqual(["ORDINARIE"]);
    expect(roles(["dsek.cafe.mdlm"])).toEqual(["ORDINARIE"]);
    expect(roles(["dsek.cafe.mastare.old"])).toEqual(["ORDINARIE"]);
  });

  it("does not grant anything to a lookalike outside the section", () => {
    expect(roles(["dsekX.ordf", "other.skattm.mastare"])).toEqual(["ORDINARIE"]);
  });

  it("reads a group however it is cased or padded", () => {
    expect(roles([" DSEK.Ordf "])).toContain("ORDFORANDE");
  });

  it("refuses a group outside the section even when a row grants it", () => {
    // The section test is the one rule no screen can edit around.
    const rogue = buildMapping([{ group: "authentik Admins", role: "SKATTMASTARE" }], []);
    expect(deriveGrants(rogue, ["authentik Admins"]).roles).toEqual(["ORDINARIE"]);
  });

  it("keeps every role and unit a person holds", () => {
    const g = grants(["dsek.ordf", "dsek.infu.mastare", "dsek.cafe.mastare"]);
    expect(g.roles).toContain("ORDFORANDE");
    expect(g.roles).toContain("RESULTATANSVARIG");
    expect(g.resultUnits).toEqual(["Caféutskottet", "Infoutskottet"]);
  });

  it("grants several roles from one group", () => {
    const many = buildMapping(
      [
        { group: "dsek.sex.mastare", role: "SKATTMASTARE" },
        { group: "dsek.sex.mastare", role: "STOCKARE" },
      ],
      [],
    );
    expect(deriveGrants(many, ["dsek.sex.mastare"]).roles).toEqual([
      "ORDINARIE",
      "SKATTMASTARE",
      "STOCKARE",
    ]);
  });

  it("grants the role and the unit from the same row", () => {
    // A resultatansvarig who answers for nothing would hold attest authority over no expense.
    const one = buildMapping([], [{ group: "dsek.x.mastare", unit: "Något" }]);
    expect(deriveGrants(one, ["dsek.x.mastare"])).toEqual({
      roles: ["ORDINARIE", "RESULTATANSVARIG"],
      resultUnits: ["Något"],
    });
  });
});

// The half of the derivation read by a person. Its answers must agree with `deriveGrants` exactly, so the first case holds them against each other.
describe("explainGrants", () => {
  const why = (groups: string[] | undefined) => explainGrants(DEFAULTS, groups);

  it("says the same thing the grant does, for any list", () => {
    const list = ["dsek.ordf", "dsek.infu.mastare", "authentik Admins", "dsek.medlem"];
    const sources = why(list);
    expect(sources.roles.map((r) => r.role)).toEqual(grants(list).roles);
    expect(sources.resultUnits.map((u) => u.unit)).toEqual(grants(list).resultUnits);
  });

  it("names the group behind each role", () => {
    const sources = why(["dsek.ordf"]);
    expect(sources.roles).toContainEqual({ role: "ORDFORANDE", groups: ["dsek.ordf"] });
  });

  it("gives the baseline no group, because nothing grants it", () => {
    expect(why([]).roles).toEqual([{ role: "ORDINARIE", groups: [] }]);
  });

  it("blames the result unit's own group for the resultatansvarig role", () => {
    const one = buildMapping([], [{ group: "dsek.x.mastare", unit: "Något" }]);
    const sources = explainGrants(one, ["dsek.x.mastare"]);
    expect(sources.roles).toContainEqual({
      role: "RESULTATANSVARIG",
      groups: ["dsek.x.mastare"],
    });
    expect(sources.resultUnits).toEqual([{ unit: "Något", groups: ["dsek.x.mastare"] }]);
  });

  it("names every group behind a role held twice over", () => {
    const sources = why(["dsek.infu.mastare", "dsek.cafe.mastare"]);
    const owner = sources.roles.find((r) => r.role === "RESULTATANSVARIG");
    expect(owner?.groups).toEqual(["dsek.infu.mastare", "dsek.cafe.mastare"]);
  });

  it("reports the groups of ours that grant nothing, and only those", () => {
    const sources = why(["dsek.ordf", "dsek.medlem", "authentik Admins"]);
    // Not `authentik Admins`: not ours to report on.
    expect(sources.silentGroups).toEqual(["dsek.medlem"]);
    expect(sources.groups).toEqual(["dsek.ordf", "dsek.medlem"]);
  });

  it("counts a mapped-but-empty group as granting nothing", () => {
    // A group added on the settings screen before a role is picked is as silent as an unmapped one.
    const blank = buildMapping([], []);
    expect(explainGrants(blank, ["dsek.sex.mastare"]).silentGroups).toEqual(["dsek.sex.mastare"]);
  });

  it("normalises and dedupes the list it read", () => {
    expect(why([" DSEK.Ordf ", "dsek.ordf"]).groups).toEqual(["dsek.ordf"]);
    expect(why([" DSEK.Ordf ", "dsek.ordf"]).roles).toContainEqual({
      role: "ORDFORANDE",
      groups: ["dsek.ordf"],
    });
  });
});

describe("the defaults the section starts from", () => {
  it("reads the treasury and the chair off their own groups", () => {
    expect(roles(["dsek.ordf"])).toContain("ORDFORANDE");
    expect(roles(["dsek.skattm.mastare"])).toContain("SKATTMASTARE");
    expect(roles(["dsek.skattm.vice_mastare"])).toContain("VICE_SKATTMASTARE");
    expect(roles(["dsek.skattm.fm"])).toContain("SKATTFORMAN");
  });

  it("hands a committee head their own result unit", () => {
    expect(grants(["dsek.cafe.mastare"])).toEqual({
      roles: ["ORDINARIE", "RESULTATANSVARIG"],
      resultUnits: ["Caféutskottet"],
    });
  });

  it("covers the committee heads that are not named .mastare", () => {
    expect(units(["dsek.fram.ordf"])).toEqual(["Framtidsutskottet"]);
    expect(units(["dsek.srd.ordf"])).toEqual(["Studierådet"]);
    expect(units(["dsek.val.ordf"])).toEqual(["Valberedningen"]);
    expect(units(["dsek.noll.stab.oph"])).toEqual(["Nollningsutskottet"]);
    expect(units(["dsek.overmarskalk"])).toEqual(["Medaljkommittén"]);
  });

  it("does not make the skattmästare a resultatansvarig as well", () => {
    // Admins attest anything; a result unit would add nothing.
    expect(roles(["dsek.skattm.mastare"])).not.toContain("RESULTATANSVARIG");
    expect(units(["dsek.skattm.mastare"])).toEqual([]);
  });

  it("gives the alkohollager to the posts that keep it", () => {
    expect(roles(["dsek.sex.bar.mstr"])).toContain("STOCKARE");
    expect(roles(["dsek.sex.hov.mstr"])).toContain("STOCKARE");
    expect(roles(["dsek.sex.pub.vice_mastare"])).toContain("STOCKARE");
    expect(grants(["dsek.sex.mastare"])).toEqual({
      roles: ["ORDINARIE", "STOCKARE", "RESULTATANSVARIG"],
      resultUnits: ["Sexmästeriet"],
    });
  });

  it("does not hand the stock to the whole committee", () => {
    expect(roles(["dsek.sex.funk"])).toEqual(["ORDINARIE"]);
    expect(roles(["dsek.sex.kok.mstr"])).toEqual(["ORDINARIE"]);
  });

  it("names every group in lower case, which is the only form that matches", () => {
    for (const { group } of [...DEFAULT_GROUP_ROLES, ...DEFAULT_GROUP_RESULT_UNITS]) {
      expect(group).toBe(group.toLowerCase());
    }
  });
});

describe("sectionGroups", () => {
  it("keeps the section's groups and drops everyone else's", () => {
    expect(sectionGroups(["dsek.ordf", "authentik Admins", "dchip.ordf"])).toEqual(["dsek.ordf"]);
  });

  it("normalises, dedupes and sorts, so the column is comparable", () => {
    expect(sectionGroups([" DSEK.Ordf ", "dsek.ordf", "dsek.cafe.mastare"])).toEqual([
      "dsek.cafe.mastare",
      "dsek.ordf",
    ]);
  });

  it("is empty rather than undefined for someone with no groups", () => {
    expect(sectionGroups(undefined)).toEqual([]);
    expect(sectionGroups([])).toEqual([]);
  });
});

// ── reapplyGrants ── The `tx` is structurally typed, so this runs against a fake. What is held is how many
// statements it takes (it runs in a 5s interactive transaction for ~1000 members) and that it only touches movers.

type UpdateCall = { ids: string[]; roles: string[]; resultUnits: string[] };

function fakeTx(
  users: { id: string; authentikGroups: string[]; roles: string[]; resultUnits: string[] }[],
  mapping: {
    roleRows?: { group: string; role: string }[];
    unitRows?: { group: string; unit: string }[];
  } = {},
) {
  const calls: UpdateCall[] = [];
  const tx = {
    groupRole: { findMany: async () => mapping.roleRows ?? [] },
    groupResultUnit: {
      findMany: async () =>
        (mapping.unitRows ?? []).map((r) => ({
          group: r.group,
          resultUnit: { name: r.unit },
        })),
    },
    user: {
      findMany: async () => users,
      updateMany: async (args: {
        where: { id: { in: string[] } };
        data: { roles: string[]; resultUnits: string[] };
      }) => {
        calls.push({
          ids: args.where.id.in,
          roles: args.data.roles,
          resultUnits: args.data.resultUnits,
        });
        return { count: args.where.id.in.length };
      },
    },
  };
  return { tx: tx as unknown as Parameters<typeof reapplyGrants>[0], calls };
}

const member = (id: string, groups: string[], roles: string[], resultUnits: string[] = []) => ({
  id,
  authentikGroups: groups,
  roles,
  resultUnits,
});

describe("reapplyGrants", () => {
  it("writes nobody when the mapping already agrees with every row", async () => {
    const { tx, calls } = fakeTx(
      [
        member("a", ["dsek.ordf"], ["ORDINARIE", "ORDFORANDE"]),
        member("b", ["dsek.x"], ["ORDINARIE"]),
      ],
      { roleRows: [{ group: "dsek.ordf", role: "ORDFORANDE" }] },
    );
    expect(await reapplyGrants(tx)).toBe(0);
    expect(calls).toEqual([]);
  });

  it("does not care what order a stored role list is in", async () => {
    // `roles` comes back from Postgres in write order and deriveGrants builds it from a Set, so compare as sets.
    const { tx, calls } = fakeTx([member("a", ["dsek.ordf"], ["ORDFORANDE", "ORDINARIE"])], {
      roleRows: [{ group: "dsek.ordf", role: "ORDFORANDE" }],
    });
    expect(await reapplyGrants(tx)).toBe(0);
    expect(calls).toEqual([]);
  });

  it("takes one statement for everybody landing on the same grant", async () => {
    // Three hundred members who all become plain ORDINARIE are one UPDATE.
    const stale = Array.from({ length: 300 }, (_, i) =>
      member(`u${i}`, ["dsek.ordf"], ["ORDINARIE", "ORDFORANDE"]),
    );
    const { tx, calls } = fakeTx(stale, { roleRows: [] }); // the mapping row is gone

    expect(await reapplyGrants(tx)).toBe(300);
    expect(calls).toHaveLength(1);
    expect(calls[0].ids).toHaveLength(300);
    expect(calls[0].roles).toEqual(["ORDINARIE"]);
  });

  it("keeps distinct grants apart, and counts people rather than statements", async () => {
    const { tx, calls } = fakeTx(
      [
        member("keeps", ["dsek.ordf"], ["ORDINARIE", "ORDFORANDE"]),
        member("loses", ["dsek.sex.mastare"], ["ORDINARIE", "STOCKARE"]),
        member("also-loses", ["dsek.sex.mastare"], ["ORDINARIE", "STOCKARE"]),
        member("gains", ["dsek.km.mastare"], ["ORDINARIE"]),
      ],
      {
        roleRows: [{ group: "dsek.ordf", role: "ORDFORANDE" }],
        unitRows: [{ group: "dsek.km.mastare", unit: "Källarmästeriet" }],
      },
    );

    expect(await reapplyGrants(tx)).toBe(3);
    expect(calls).toHaveLength(2);

    const dropped = calls.find((c) => c.ids.includes("loses"))!;
    expect(dropped.ids.sort()).toEqual(["also-loses", "loses"]);
    expect(dropped.roles).toEqual(["ORDINARIE"]);

    const gained = calls.find((c) => c.ids.includes("gains"))!;
    expect(gained.ids).toEqual(["gains"]);
    expect(gained.roles.sort()).toEqual(["ORDINARIE", "RESULTATANSVARIG"]);
    expect(gained.resultUnits).toEqual(["Källarmästeriet"]);
  });

  it("separates grants that differ only in their result units", async () => {
    // Same roles, different reach: bucketing on roles alone would hand one committee's money to the other's head.
    const { tx, calls } = fakeTx(
      [
        member("km", ["dsek.km.mastare"], ["ORDINARIE"]),
        member("cafe", ["dsek.cafe.mastare"], ["ORDINARIE"]),
      ],
      {
        unitRows: [
          { group: "dsek.km.mastare", unit: "Källarmästeriet" },
          { group: "dsek.cafe.mastare", unit: "Caféutskottet" },
        ],
      },
    );

    expect(await reapplyGrants(tx)).toBe(2);
    expect(calls).toHaveLength(2);
    expect(calls.map((c) => c.resultUnits).sort()).toEqual([
      ["Caféutskottet"],
      ["Källarmästeriet"],
    ]);
  });
});
