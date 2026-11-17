// Role to capability set, read from the database (the other half of authority; see authentik-roles.ts).
// The rows are edited in Inställningar → Roller; the Role and Capability enums stay in code.
import "server-only";

import { cache } from "react";
import { prisma } from "@/lib/server/db";
import type { Capability, Role } from "@/lib/domain/types";

/** The whole matrix, deduped per request (a couple of dozen rows, fetched whole). */
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

/** What a set of roles may do together: the deduped union. A role the matrix says nothing about gives nothing, not an error. */
export async function capabilitiesOf(roles: readonly Role[]): Promise<Capability[]> {
  const matrix = await roleCapabilities();
  const caps = new Set<Capability>();
  for (const role of roles) {
    for (const cap of matrix.get(role) ?? []) caps.add(cap);
  }
  return [...caps];
}

/**
 * Whether at least one live person would still be able to reach Inställningar. The invariant this feature
 * cannot break: a grid saved with nobody holding SETTINGS locks everyone out. Checked against what people
 * actually hold, after the write inside its transaction. See app/api/authority.
 *
 * A personal grant counts only when it has no end: one that runs out would leave the lock-out for later.
 */
export async function someoneCanReachSettings(
  tx: Pick<typeof prisma, "roleCapability" | "user">,
  now: Date = new Date(),
): Promise<boolean> {
  const holders = await tx.roleCapability.findMany({
    where: { capability: "SETTINGS" },
    select: { role: true },
  });
  const roles = holders.map((h) => h.role);

  const count = await tx.user.count({
    where: {
      active: true,
      OR: [
        ...(roles.length > 0 ? [{ roles: { hasSome: roles } }] : []),
        {
          accessGrants: {
            some: {
              validFrom: { lte: now },
              validUntil: null,
              OR: [
                { capability: "SETTINGS" },
                ...(roles.length > 0 ? [{ role: { in: roles } }] : []),
              ],
            },
          },
        },
      ],
    },
  });
  return count > 0;
}
