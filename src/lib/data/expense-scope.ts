// Which utlägg a person may see: bookkeeping roles and revisor see all, a resultatansvarig sees
// those touching their result units, everyone sees their own.
import "server-only";

import { prisma } from "@/lib/server/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { costCentreWhereForPrefixes, ownedResultUnits } from "@/lib/server/result-units";
import { canViewBookkeeping } from "@/lib/domain/permissions";
import type { Capability, Role } from "@/lib/domain/types";

export type Viewer = { id: string; roles: Role[]; capabilities: Capability[] };

/** Everything, or own plus the result units' cost-centre code prefixes (membership is derived from the code). */
export type ExpenseScope =
  { everything: true } | { everything: false; userId: string; resultUnitPrefixes: string[] };

export async function expenseScopeOf(viewer: Viewer): Promise<ExpenseScope> {
  if (canViewBookkeeping(viewer.capabilities)) return { everything: true };
  const { prefixes } = await ownedResultUnits(viewer);
  return { everything: false, userId: viewer.id, resultUnitPrefixes: prefixes };
}

/** The scope as a Prisma filter. Unrestricted is the empty filter. */
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

/** Whether a fetched expense is in scope. Only a result unit head asking about someone else's utlägg costs a query. */
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
