// Role → what it may do, read from the database.
//
// The other half of authority. lib/server/authentik-roles.ts turns an Authentik
// group list into roles and result units and writes them to the User row; this
// turns those roles into the capability set every gate in the app actually
// reads (lib/domain/permissions.ts).
//
// Both halves are rows now rather than lists in a file, because the section
// edits them — see Inställningar → Roller. What stays in code is the vocabulary:
// the Role and Capability enums, and the meaning of each capability at the call
// site that asks about it. A row can say who holds a capability; it cannot
// invent one.
import "server-only";

import { cache } from "react";
import { prisma } from "@/lib/server/db";
import type { Capability, Role } from "@/lib/domain/types";

/**
 * The whole matrix, deduped per request.
 *
 * One query per request rather than one per user: a page that resolves the
 * acting user and then lists twenty people with their roles asks this once. It
 * is a couple of dozen rows — small enough to fetch whole, and fetching it
 * whole is what lets the settings screen render the grid from the same source
 * the gates read.
 */
export const roleCapabilities = cache(async (): Promise<Map<Role, Capability[]>> => {
  const rows = await prisma.roleCapability.findMany({
    select: { role: true, capability: true },
  });

  const byRole = new Map<Role, Capability[]>();
  for (const { role, capability } of rows) {
    const list = byRole.get(role) ?? [];
    list.push(capability);
    byRole.set(role, list);
  }
  return byRole;
});

/**
 * What a set of roles may do, together.
 *
 * The union, deduped: holding two roles gives you everything either one has,
 * and holding a role the matrix says nothing about gives you nothing. That last
 * case is not an error — a role with no capabilities is what "this role exists
 * but does nothing yet" looks like, and refusing it here would turn an empty
 * grid row into a crash.
 */
export async function capabilitiesOf(roles: readonly Role[]): Promise<Capability[]> {
  const matrix = await roleCapabilities();
  const caps = new Set<Capability>();
  for (const role of roles) {
    for (const cap of matrix.get(role) ?? []) caps.add(cap);
  }
  return [...caps];
}

/**
 * Whether at least one live person would still be able to reach Inställningar.
 *
 * The one invariant this whole feature cannot be allowed to break. Every screen
 * that edits authority is reachable only through SETTINGS, so a grid saved with
 * nobody holding it is a door locked from the inside — and the only way back in
 * is an UPDATE typed into the production database by hand.
 *
 * Checked against the roles people *actually hold*, not against the matrix
 * alone: SETTINGS granted only to a role nobody has is the same lockout wearing
 * a tick. And checked after the write inside the transaction that made it, so
 * what is tested is the outcome rather than a prediction of it — see the
 * settings routes under app/api/authority.
 */
export async function someoneCanReachSettings(
  tx: Pick<typeof prisma, "roleCapability" | "user">,
): Promise<boolean> {
  const holders = await tx.roleCapability.findMany({
    where: { capability: "SETTINGS" },
    select: { role: true },
  });
  if (holders.length === 0) return false;

  const count = await tx.user.count({
    where: { active: true, roles: { hasSome: holders.map((h) => h.role) } },
  });
  return count > 0;
}
