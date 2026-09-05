// What Inställningar → Roller reads.
//
// Two questions, and the second is the one that makes the screen safe to use:
//
//   • what the mapping says: which Authentik group confers which role and
//     result unit, and what each role may do;
//   • what the section actually holds: which groups real people are in, how
//     many of them each mapping row reaches, and which groups people hold that
//     the mapping says nothing about.
//
// Without the second half, editing authority is typing group names from memory
// and hoping. `User.authentikGroups` is what makes it answerable: the group list
// as it stood at each person's last sign-in, stored for exactly this
// (lib/server/authentik-roles.ts).
import "server-only";

import { prisma } from "@/lib/server/db";
import { explainGrants, groupMapping } from "@/lib/server/authentik-roles";
import { ROLES } from "@/lib/domain/permissions";
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
   * visible. A misspelled name grants nothing, silently, for as long as
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
   * People whose group list we have never seen. They have not signed in since
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
      // It was the narrower set, which is right for the group counts. A group
      // holder is by definition somebody we have a group list for, and wrong
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
  // wild is a post nothing has been decided about yet, and all three belong on
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

// ── Why one person holds what they hold ───────────────────────────
//
// Authority is derived at sign-in and stored on the User row, which makes it
// fast to read and impossible to interrogate: a role is a value in a column,
// with nothing beside it saying where it came from. So when somebody turns out
// to be resultatansvarig and nobody can think of a mandate that would do that,
// the only way to find out used to be to open Authentik, read a group list, and
// compare it by eye against the mapping, for a role that may well have been
// derived from a group list that has since changed.
//
// The evidence is already kept (`User.authentikGroups`), and the derivation is
// already a pure function of it, so this simply runs the derivation again with
// its workings shown and lays the result against what the row actually says.
// Three answers come out of that, and they are different problems:
//
//   • a role with groups behind it: the ordinary case, and the group name is
//     what somebody goes and looks at next;
//   • a role with nothing behind it: held here, granted by nothing. Either the
//     mandate ended in Authentik and its holder has not signed in since (their
//     stored group list is as stale as the role), or it predates the mapping
//     entirely. It is a leftover either way, and it will not clear itself until
//     they sign in;
//   • a role the mapping grants that the row does not have yet: the mirror
//     image, landing at their next sign-in.

type RoleReason = {
  role: Role;
  /** The person's groups that confer it. Empty for ORDINARIE, and for a leftover. */
  groups: string[];
  /** The floor every member stands on, not a grant. Has no groups by design. */
  baseline: boolean;
  /** Held, and nothing in their stored group list accounts for it. */
  leftover: boolean;
};

type UnitReason = {
  /** A ResultUnit *name*, the way User.resultUnits stores it. */
  unit: string;
  groups: string[];
  leftover: boolean;
  /** Whether a result unit by that name still exists. One that does not grants
   *  nothing. Attest is matched by name (lib/domain/permissions.ts). */
  exists: boolean;
};

export type UserAuthority = {
  user: { id: string; name: string; email: string };
  /** Their section groups, as of their last sign-in. */
  groups: string[];
  /** Groups they hold that the mapping grants nothing for. */
  silentGroups: string[];
  /** Every role on the row, in the app's role order, with what accounts for it. */
  roles: RoleReason[];
  /** Every result unit on the row, likewise. */
  resultUnits: UnitReason[];
  /** What the mapping would grant that the row does not carry. Lands at their
   *  next sign-in. Non-empty means the row is behind the mapping, which after a
   *  mapping edit should not happen (`reapplyGrants` catches everyone up), so it
   *  is worth saying out loud when it does. */
  pendingRoles: Role[];
  pendingUnits: string[];
  /** No group list stored at all: they have not signed in since the column was
   *  added, so nothing here can be explained, not even the roles they hold. */
  neverSeen: boolean;
};

export async function getUserAuthority(userId: string): Promise<UserAuthority | null> {
  const [user, mapping] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        roles: true,
        resultUnits: true,
        authentikGroups: true,
      },
    }),
    groupMapping(),
  ]);
  if (!user) return null;

  const sources = explainGrants(mapping, user.authentikGroups);
  const behindRole = new Map(sources.roles.map((r) => [r.role, r.groups]));
  const behindUnit = new Map(sources.resultUnits.map((u) => [u.unit, u.groups]));

  // Only asked when they answer for something, and only about the names on
  // their row: a name with no result unit behind it is held and inert, and the
  // screen says so rather than showing it as authority they do not have.
  const existing = user.resultUnits.length
    ? new Set(
        (
          await prisma.resultUnit.findMany({
            where: { name: { in: user.resultUnits } },
            select: { name: true },
          })
        ).map((u) => u.name),
      )
    : new Set<string>();

  // In the app's role order rather than the column's, which is insertion order
  // from whichever sign-in last wrote it and means nothing to a reader.
  const roles: RoleReason[] = ROLES.filter((r) => user.roles.includes(r)).map((role) => {
    const groups = behindRole.get(role) ?? [];
    return {
      role,
      groups,
      baseline: role === "ORDINARIE",
      leftover: role !== "ORDINARIE" && groups.length === 0,
    };
  });

  const resultUnits: UnitReason[] = [...user.resultUnits]
    .sort((a, b) => a.localeCompare(b, "sv"))
    .map((unit) => {
      const groups = behindUnit.get(unit) ?? [];
      return { unit, groups, leftover: groups.length === 0, exists: existing.has(unit) };
    });

  return {
    user: { id: user.id, name: user.name, email: user.email },
    groups: sources.groups,
    silentGroups: sources.silentGroups,
    roles,
    resultUnits,
    pendingRoles: sources.roles.map((r) => r.role).filter((r) => !user.roles.includes(r)),
    pendingUnits: sources.resultUnits
      .map((u) => u.unit)
      .filter((u) => !user.resultUnits.includes(u)),
    neverSeen: user.authentikGroups.length === 0,
  };
}
