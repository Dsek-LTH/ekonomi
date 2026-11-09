// Which utlägg a person may attest, as a Prisma filter. Must agree with `canAttestAllocation`
// (domain/permissions.ts), which still decides the buttons and the API write check.
import "server-only";

import type { Prisma } from "@/lib/generated/prisma/client";
import { costCentreWhereForPrefixes, ownedResultUnits } from "@/lib/server/result-units";
import { isAdmin } from "@/lib/domain/permissions";
import type { Viewer } from "./expense-scope";

/**
 * Everything the viewer may attest, read clause for clause off `canAttestAllocation`.
 * `ownUnits` drops the skattmästare's blanket clause (nav counts, "Min resultatenhet").
 * No attest authority gives a filter matching nothing, not an empty `OR`.
 */
export async function attestScopeWhere(
  viewer: Viewer,
  { ownUnits = false }: { ownUnits?: boolean } = {},
): Promise<Prisma.ExpenseWhereInput> {
  const notMine: Prisma.ExpenseWhereInput = { submitterId: { not: viewer.id } };

  if (!ownUnits && isAdmin(viewer.capabilities)) return notMine;

  const authority: Prisma.ExpenseWhereInput[] = [];

  const { prefixes } = await ownedResultUnits(viewer);
  if (prefixes.length) {
    authority.push({
      allocations: { some: { costCenter: costCentreWhereForPrefixes(prefixes) } },
    });
  }

  // `id: undefined` would be no filter; a contradiction matches nothing.
  if (authority.length === 0) return { id: { in: [] } };

  return { AND: [notMine, { OR: authority }] };
}
