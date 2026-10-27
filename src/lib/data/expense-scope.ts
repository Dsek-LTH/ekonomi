// Which utlägg a person may see. One rule, stated once:
//
//   • a bookkeeping role (skattmästare, ordförande, vice, skattförman) sees
//     everything, and so does a revisor, who may read the books but not work
//     them;
//   • a resultatansvarig sees expenses touching a result unit they answer for;
//   • everyone sees their own.
//
// It is asked in three different shapes, which is how it came to be written
// three times. A list needs it as a query filter, the detail loader needs it
// folded into a lookup, and an API route needs it as a yes/no about an expense
// it has already fetched. So the rule is resolved once into an `ExpenseScope`:
// a plain description of what this viewer may reach, and each shape is derived
// from that value rather than restating the policy.
import "server-only";

import { prisma } from "@/lib/server/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { costCentreWhereForPrefixes, ownedResultUnits } from "@/lib/server/result-units";
import { canViewBookkeeping } from "@/lib/domain/permissions";
import type { Capability, Role } from "@/lib/domain/types";

/** Who is asking. Both a page's session user and an API `Actor` fit this. */
export type Viewer = { id: string; roles: Role[]; capabilities: Capability[] };

/**
 * What one viewer may reach. Either everything, or their own plus whatever the
 * result units they answer for cover, as cost-centre code prefixes, since
 * result unit membership is derived from the code rather than stored.
 */
export type ExpenseScope =
  | { everything: true }
  | { everything: false; userId: string; resultUnitPrefixes: string[] };

/** Resolve `viewer` to their scope. This is the only place the policy lives. */
export async function expenseScopeOf(viewer: Viewer): Promise<ExpenseScope> {
  if (canViewBookkeeping(viewer.capabilities)) return { everything: true };
  const { prefixes } = await ownedResultUnits(viewer);
  return { everything: false, userId: viewer.id, resultUnitPrefixes: prefixes };
}

/**
 * The scope as a Prisma filter, to narrow a query to what the viewer may see.
 * An unrestricted scope is the empty filter, so it composes into any `where`
 * without a special case at the call site.
 */
export function expenseScopeWhere(scope: ExpenseScope): Prisma.ExpenseWhereInput {
  if (scope.everything) return {};

  const OR: Prisma.ExpenseWhereInput[] = [{ submitterId: scope.userId }];
  if (scope.resultUnitPrefixes.length) {
    OR.push({
      allocations: {
        some: { costCenter: costCentreWhereForPrefixes(scope.resultUnitPrefixes) },
      },
    });
  }
  return { OR };
}

/**
 * Whether one already-fetched expense falls inside the scope.
 *
 * For a route that holds the expense but not its allocations. Only a result unit
 * head asking about someone else's utlägg costs a query. For everyone else the
 * scope alone settles it.
 */
export async function scopeIncludes(
  scope: ExpenseScope,
  expense: { id: string; submitterId: string },
): Promise<boolean> {
  if (scope.everything) return true;
  if (expense.submitterId === scope.userId) return true;
  if (scope.resultUnitPrefixes.length === 0) return false;

  const touching = await prisma.expenseCostAllocation.count({
    where: {
      expenseId: expense.id,
      costCenter: costCentreWhereForPrefixes(scope.resultUnitPrefixes),
    },
  });
  return touching > 0;
}
