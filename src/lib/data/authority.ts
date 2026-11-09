// What Inställningar → Roller reads: the group-to-role mapping, and what the section actually holds
// (`User.authentikGroups`, the group list at each person's last sign-in; lib/server/authentik-roles.ts).
import "server-only";

import { prisma } from "@/lib/server/db";
import { explainGrants, groupMapping } from "@/lib/server/authentik-roles";
import { ROLES } from "@/lib/domain/permissions";
import type { Capability, Role } from "@/lib/domain/types";

export type GroupRow = {
  /** The Authentik group, lower-cased, as everything here compares it. */
  group: string;
  roles: Role[];
  resultUnits: { id: string; name: string }[];
  /** People who signed in since `authentikGroups` existed and hold this group. `0` on a mapped group means a misspelled name granting nothing. */
  holders: number;
};

export type AuthorityData = {
  groups: GroupRow[];
  resultUnits: { id: string; name: string }[];
  roleCapabilities: { role: Role; capability: Capability }[];
  roleHolders: Record<string, number>;
  /** People whose group list we have never seen. Outside the group counts, inside `roleHolders`. */
  membersWithoutGroups: number;
};

export async function getAuthority(): Promise<AuthorityData> {
  const [groupRoles, groupUnits, resultUnits, roleCapabilities, users, withoutGroups] =
    await Promise.all([
      prisma.groupRole.findMany({ select: { group: true, role: true } }),
      prisma.groupResultUnit.findMany({
        select: { group: true, resultUnit: { select: { id: true, name: true } } },
      }),
      prisma.resultUnit.findMany({
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      prisma.roleCapability.findMany({ select: { role: true, capability: true } }),
      // Every *active* member, not only those whose group list we have seen: role counts come off a
      // column every member has, and the narrower set made the grid skip its confirmation.
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

  // Over every active member, the population `someoneCanReachSettings` counts for the lockout check.
  const roleHolders: Record<string, number> = {};
  for (const u of users) {
    for (const r of u.roles) roleHolders[r] = (roleHolders[r] ?? 0) + 1;
  }

  // Union of the mapping and what people hold: both, only mapped (probably a typo), only held (undecided).
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

// Why one person holds what they hold: re-runs the derivation from the stored group list and lays it
// against the row. A role with no groups behind it is a leftover until they sign in; a role the
// mapping grants but the row lacks lands at their next sign-in.

type RoleReason = {
  role: Role;
  /** The person's groups that confer it. Empty for ORDINARIE, and for a leftover. */
  groups: string[];
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
  groups: string[];
  silentGroups: string[];
  roles: RoleReason[];
  resultUnits: UnitReason[];
  /** What the mapping would grant that the row lacks (lands at next sign-in). Should be empty after a mapping edit (`reapplyGrants`). */
  pendingRoles: Role[];
  pendingUnits: string[];
  /** No group list stored: not signed in since the column was added, so nothing is explainable. */
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

  // Only about names on their row: a name with no result unit behind it is held but inert.
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

  // In the app's role order, not the column's insertion order.
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
