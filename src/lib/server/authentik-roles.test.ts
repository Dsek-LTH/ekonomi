import { describe, expect, it } from "vitest";
import {
  DEFAULT_GROUP_RESULT_UNITS,
  DEFAULT_GROUP_ROLES,
} from "./authority-defaults";
import { buildMapping, deriveGrants, reapplyGrants, sectionGroups } from "./authentik-roles";

// The mapping is rows now, edited in Inställningar → Roller, so what a
// deployment grants is not something a unit test can know. Two things still are,
// and they are the two worth holding:
//
//   • the derivation — how a group list becomes roles and result units, which is
//     code and is what every sign-in runs;
//   • the defaults — the state the section starts from, which is where every
//     policy decision this file used to record still lives.
//
// So each case below is one of those, and the second kind reads exactly as it
// did when the mapping was a table in this file: a policy decision written down.
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
    // Authentik gains groups for reasons that have nothing to do with this app.
    expect(roles(["authentik Admins", "dsek.medlem", "dchip.ordf"])).toEqual(["ORDINARIE"]);
  });

  it("ignores a retired mandate", () => {
    // Upstream prefixes historic positions `old.`, which puts them outside the
    // section test — a mandate that ended is not a mandate.
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
    // The section test is the one rule no screen can edit around. A row naming
    // `authentik Admins` can be written; it still confers nothing.
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
    // What the table could not say before: a group mapped to a row per role.
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
    // The pair is the whole point: a resultatansvarig who answers for nothing
    // would hold attest authority over no expense, which is not a state worth
    // being able to reach.
    const one = buildMapping([], [{ group: "dsek.x.mastare", unit: "Något" }]);
    expect(deriveGrants(one, ["dsek.x.mastare"])).toEqual({
      roles: ["ORDINARIE", "RESULTATANSVARIG"],
      resultUnits: ["Något"],
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
    // Admins attest anything; a result unit would add nothing and would put the
    // treasurer in the resultatansvarig lists on every screen that has one.
    expect(roles(["dsek.skattm.mastare"])).not.toContain("RESULTATANSVARIG");
    expect(units(["dsek.skattm.mastare"])).toEqual([]);
  });

  it("gives the alkohollager to the posts that keep it", () => {
    expect(roles(["dsek.sex.bar.mstr"])).toContain("STOCKARE");
    expect(roles(["dsek.sex.hov.mstr"])).toContain("STOCKARE");
    expect(roles(["dsek.sex.pub.vice_mastare"])).toContain("STOCKARE");
    // Sexmästaren keeps the stock *and* answers for the money.
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

// ── reapplyGrants ───────────────────────────────────────────────────
//
// The `tx` it takes is structurally typed, so the whole thing runs against a
// fake here — which is the point: what is worth holding about this function is
// not that Prisma works, it is *how many statements it takes to do its job* and
// that it still only touches people who actually moved.
//
// It writes a row per member, and it does it inside an interactive transaction
// against a five-second timeout, for a section of about a thousand. So the
// grouping below is not a tidiness: it is the difference between a mapping edit
// that lands and one that rolls back with nothing to say.

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
        (mapping.unitRows ?? []).map((r) => ({ group: r.group, resultUnit: { name: r.unit } })),
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
      [member("a", ["dsek.ordf"], ["ORDINARIE", "ORDFORANDE"]), member("b", ["dsek.x"], ["ORDINARIE"])],
      { roleRows: [{ group: "dsek.ordf", role: "ORDFORANDE" }] },
    );
    expect(await reapplyGrants(tx)).toBe(0);
    expect(calls).toEqual([]);
  });

  it("does not care what order a stored role list is in", async () => {
    // `roles` comes back from Postgres in whatever order it was written, and
    // deriveGrants builds it from a Set. Comparing them as sequences would
    // rewrite the whole section every time somebody saved the grid.
    const { tx, calls } = fakeTx(
      [member("a", ["dsek.ordf"], ["ORDFORANDE", "ORDINARIE"])],
      { roleRows: [{ group: "dsek.ordf", role: "ORDFORANDE" }] },
    );
    expect(await reapplyGrants(tx)).toBe(0);
    expect(calls).toEqual([]);
  });

  it("takes one statement for everybody landing on the same grant", async () => {
    // The whole reason this is batched. Three hundred members who all become
    // plain ORDINARIE is one UPDATE, not three hundred.
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
    // Two statements: the pair dropping to bare ORDINARIE, and the one picking
    // up resultatansvar.
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
    // Same roles, different reach: bucketing on the roles alone would hand one
    // committee's money to the other's head.
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
    expect(calls.map((c) => c.resultUnits).sort()).toEqual([["Caféutskottet"], ["Källarmästeriet"]]);
  });
});
