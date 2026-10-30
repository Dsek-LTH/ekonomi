// Which utlägg a person may *attest*, as a query, so the attest queue can be
// asked for rather than filtered out of everything.
//
// This is the same move `expense-scope.ts` makes for "may see", and for the
// same reason: the rule already exists as a predicate (`canAttestAllocation` in
// domain/permissions.ts, which decides one allocation with every input handed
// to it), but a predicate can only be applied to rows already loaded. The
// approvals page used to load every utlägg in the section and keep the ones
// where some allocation came back true. That works and is unarguably correct;
// it just cannot be paged.
//
// So the same rule is resolved once into a Prisma filter. The two must agree:
// `canAttestAllocation` still decides what the buttons do, row by row, and is
// still what the API enforces on write. This only decides which rows are worth
// fetching, and is written to be the same rule read the other way round.
import "server-only";

import type { Prisma } from "@/lib/generated/prisma/client";
import { costCentreWhereForPrefixes, ownedResultUnits } from "@/lib/server/result-units";
import { isAdmin } from "@/lib/domain/permissions";
import type { Viewer } from "./expense-scope";

/**
 * Everything the viewer may attest something on, as a filter.
 *
 * Read straight off `canAttestAllocation`, clause for clause:
 *
 *   • never your own utlägg, the first thing that function says, and the one
 *     rule that holds however many roles you have, so it is an AND over the
 *     rest rather than one of the alternatives;
 *   • skattmästare / ordförande: anyone else's, unconditionally;
 *   • resultatansvarig: those with an allocation on a cost centre belonging to
 *     a result unit they answer for, which is a code prefix, exactly as in
 *     expense-scope.
 *
 * Someone with no attest authority at all gets a filter that matches nothing,
 * rather than one that matches everything. An empty `OR` would be the second.
 *
 * `ownUnits` leaves out the skattmästare's blanket clause, for the counts of
 * what waits on the viewer (lib/data/nav-counts.ts). The skattmästare may
 * attest anyone's, but only their own result units' are theirs to do, and a
 * count of the whole section's never goes away.
 */
export async function attestScopeWhere(
  viewer: Viewer,
  { ownUnits = false }: { ownUnits?: boolean } = {},
): Promise<Prisma.ExpenseWhereInput> {
  const notMine: Prisma.ExpenseWhereInput = { submitterId: { not: viewer.id } };

  if (!ownUnits && isAdmin(viewer.capabilities)) return notMine;

  const authority: Prisma.ExpenseWhereInput[] = [];

  // `ownedResultUnits` already returns nothing unless the role backs the
  // ownership, so the role check is not repeated here.
  const { prefixes } = await ownedResultUnits(viewer);
  if (prefixes.length) {
    authority.push({
      allocations: { some: { costCenter: costCentreWhereForPrefixes(prefixes) } },
    });
  }

  // `id: undefined` would be no filter at all; a contradiction is the honest
  // way to say "nothing", and Postgres discards it without reading the table.
  if (authority.length === 0) return { id: { in: [] } };

  return { AND: [notMine, { OR: authority }] };
}
