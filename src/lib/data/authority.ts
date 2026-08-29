// What Inställningar → Roller reads.
//
// Two questions, and the second is the one that makes the screen safe to use:
//
//   • what the mapping says — which Authentik group confers which role and
//     result unit, and what each role may do;
//   • what the section actually holds — which groups real people are in, how
//     many of them each mapping row reaches, and which groups people hold that
//     the mapping says nothing about.
//
// Without the second half, editing authority is typing group names from memory
// and hoping. `User.authentikGroups` is what makes it answerable: the group list
// as it stood at each person's last sign-in, stored for exactly this
// (lib/server/authentik-roles.ts).
import "server-only";

import { prisma } from "@/lib/server/db";
import type { Capability, Role } from "@/lib/domain/types";

export type GroupRow = {
  /** The Authentik group, lower-cased, as everything here compares it. */
  group: string;
  roles: Role[];
  /** Result units this group makes someone answer for, by id and name. */
  resultUnits: { id: string; name: string }[];
  /**
   * How many people signed in since `authentikGroups` existed are in this
   * group. `0` on a mapped group is the failure this screen exists to make
   * visible — a misspelled name grants nothing, silently, for as long as
   * nobody looks.
   */
  holders: number;
};

export type AuthorityData = {
  /** Every group the mapping mentions, plus every one people are seen to hold. */
  groups: GroupRow[];
  /** Result units available to map, for the picker. */
  resultUnits: { id: string; name: string }[];
  /** The role × capability grid, as ticked pairs. */
  roleCapabilities: { role: Role; capability: Capability }[];
  /** How many active members hold each role right now. */
  roleHolders: Record<string, number>;
  /**
   * People whose group list we have never seen — they have not signed in since
   * the column was added.
   *
   * They are outside the *group* counts, which can only be counts of people we
   * have a group list for, and the screen says so rather than letting those
   * numbers read as complete. They are inside `roleHolders`, which comes off a
   * column every member has.
   */
  membersWithoutGroups: number;
};

export async function getAuthority(): Promise<AuthorityData> {
  const [groupRoles, groupUnits, resultUnits, roleCapabilities, users, withoutGroups] =
    await Promise.all([
      prisma.groupRole.findMany({ select: { group: true, role: true } }),
      prisma.groupResultUnit.findMany({
        select: { group: true, resultUnit: { select: { id: true, name: true } } },
      }),
      prisma.resultUnit.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
      prisma.roleCapability.findMany({ select: { role: true, capability: true } }),
      // Every group anyone is actually in, and every role anyone holds. The
      // section has ~1000 members and this is two small array columns off each
      // of them; the alternative is a count query per mapping row, which is
      // worse and still would not surface the groups nothing maps to.
      //
      // Every *active* member, not only the ones whose group list we have seen.
      // It was the narrower set, which is right for the group counts — a group
      // holder is by definition somebody we have a group list for — and wrong
      // for the role counts, which come off a column every member has. A role
      // held by two hundred people who had not signed in lately read as nought,
      // so the grid below skipped its confirmation and handed them a capability
      // without stopping to ask. The empty-group rows contribute nothing to
      // `holders` on their own, so widening this changes only what it should.
      prisma.user.findMany({
        where: { active: true },
        select: { authentikGroups: true, roles: true },
      }),
      prisma.user.count({ where: { active: true, authentikGroups: { isEmpty: true } } }),
    ]);

  const holders = new Map<string, number>();
  for (const u of users) {
    for (const g of u.authentikGroups) holders.set(g, (holders.get(g) ?? 0) + 1);
  }

  // Counted over every active member, which is the population
  // `someoneCanReachSettings` counts when it decides whether a change has
  // locked everybody out. The two disagreeing is what let the screen show a
  // number the invariant did not believe.
  const roleHolders: Record<string, number> = {};
  for (const u of users) {
    for (const r of u.roles) roleHolders[r] = (roleHolders[r] ?? 0) + 1;
  }

  // Union of what the mapping names and what people hold. A group in both is
  // a working row; one only in the mapping is probably a typo; one only in the
  // wild is a post nothing has been decided about yet — and all three belong on
  // the same list, because the reader's question is "what is there".
  const names = new Set<string>([
    ...groupRoles.map((r) => r.group),
    ...groupUnits.map((r) => r.group),
    ...holders.keys(),
  ]);

  const groups: GroupRow[] = [...names]
    .sort((a, b) => a.localeCompare(b, "sv"))
    .map((group) => ({
      group,
      roles: groupRoles.filter((r) => r.group === group).map((r) => r.role),
      resultUnits: groupUnits.filter((r) => r.group === group).map((r) => r.resultUnit),
      holders: holders.get(group) ?? 0,
    }));

  return {
    groups,
    resultUnits,
    roleCapabilities,
    roleHolders,
    membersWithoutGroups: withoutGroups,
  };
}
