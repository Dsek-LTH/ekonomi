// Personal grants (AccessGrant): a role or a capability given to one member by hand, on top of what their
// Authentik groups give them (User.roles, lib/server/authentik-roles.ts). Read at request time, so a grant
// starts and ends to the second with nothing stored to recompute.
import "server-only";

import { cache } from "react";
import { prisma } from "@/lib/server/db";
import { roleCapabilities } from "@/lib/server/capabilities";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { Capability, Role } from "@/lib/domain/types";

/** The grants in force at `now`: started, and not yet ended. */
export const inForce = (now: Date = new Date()): Prisma.AccessGrantWhereInput => ({
  validFrom: { lte: now },
  OR: [{ validUntil: null }, { validUntil: { gt: now } }],
});

/** What a member's personal grants in force add. */
export interface PersonalGrants {
  roles: Role[];
  capabilities: Capability[];
}

const NONE: PersonalGrants = { roles: [], capabilities: [] };

/** The personal grants in force for each of `userIds`. Members with none are absent from the map. */
export async function personalGrantsOf(
  userIds: readonly string[],
): Promise<Map<string, PersonalGrants>> {
  const out = new Map<string, PersonalGrants>();
  if (userIds.length === 0) return out;
  const rows = await prisma.accessGrant.findMany({
    where: { userId: { in: [...userIds] }, ...inForce() },
    select: { userId: true, role: true, capability: true },
  });
  for (const row of rows) {
    const held = out.get(row.userId) ?? { roles: [], capabilities: [] };
    if (row.role && !held.roles.includes(row.role)) held.roles.push(row.role);
    if (row.capability && !held.capabilities.includes(row.capability)) {
      held.capabilities.push(row.capability);
    }
    out.set(row.userId, held);
  }
  return out;
}

/** One member's personal grants in force. Deduped per request. */
export const personalGrants = cache(
  async (userId: string): Promise<PersonalGrants> =>
    (await personalGrantsOf([userId])).get(userId) ?? NONE,
);

/**
 * What a member holds, all sources together: the roles their groups give plus the roles granted to them,
 * and everything those roles may do plus the capabilities granted to them. Pure given the matrix.
 */
export function combine(
  matrix: ReadonlyMap<Role, readonly Capability[]>,
  groupRoles: readonly Role[],
  granted: PersonalGrants,
): { roles: Role[]; capabilities: Capability[] } {
  const roles = [...new Set([...groupRoles, ...granted.roles])];
  const caps = new Set<Capability>(granted.capabilities);
  for (const role of roles) for (const cap of matrix.get(role) ?? []) caps.add(cap);
  return { roles, capabilities: [...caps] };
}

/** `combine` against the matrix as it stands. */
export async function effectiveAuthority(
  groupRoles: readonly Role[],
  granted: PersonalGrants,
): Promise<{ roles: Role[]; capabilities: Capability[] }> {
  return combine(await roleCapabilities(), groupRoles, granted);
}

/**
 * The members who hold any of `roles`, or `capability` itself, through a group or a grant in force. A
 * `where` for prisma.user, so callers add their own conditions (active, ids) next to it.
 */
export function holdingWhere(
  roles: readonly Role[],
  capability?: Capability,
  now: Date = new Date(),
): Prisma.UserWhereInput {
  const granted: Prisma.AccessGrantWhereInput[] = [];
  if (roles.length > 0) granted.push({ role: { in: [...roles] } });
  if (capability) granted.push({ capability });
  return {
    OR: [
      ...(roles.length > 0 ? [{ roles: { hasSome: [...roles] } }] : []),
      ...(granted.length > 0
        ? [{ accessGrants: { some: { AND: [inForce(now), { OR: granted }] } } }]
        : []),
    ],
  };
}

/** The roles that currently hold `cap`, from the editable matrix. */
export async function rolesWith(cap: Capability): Promise<Role[]> {
  const matrix = await roleCapabilities();
  return [...matrix].filter(([, caps]) => caps.includes(cap)).map(([role]) => role);
}

/** Every active member holding `cap`, through a role (from a group or granted) or a grant of the capability itself. */
export async function holdersOf(cap: Capability): Promise<string[]> {
  const users = await prisma.user.findMany({
    where: { active: true, ...holdingWhere(await rolesWith(cap), cap) },
    select: { id: true },
  });
  return users.map((u) => u.id);
}

/** Delete the grants that have run out. They grant nothing already; this only keeps the table to what is live. */
export async function pruneEndedGrants(now: Date = new Date()): Promise<void> {
  await prisma.accessGrant.deleteMany({ where: { validUntil: { lte: now } } });
}
