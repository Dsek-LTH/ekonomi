// Budget (`resolveBudget`'s pick) vs ledger utfall per result unit and cost centre, the same
// figures as /ledger. Arithmetic in lib/budget/overview.ts.
import "server-only";

import { prisma } from "@/lib/server/db";
import { buildOverview, type OverviewUnit } from "@/lib/budget/overview";
import { budgetComparison, resolveBudget } from "@/lib/ledger/comparison";
import { financialYearIdForCalendarYear } from "@/lib/ledger";
import { getPrefixes, resultUnitForCode } from "@/lib/server/result-units";

export type { BudgetFigure, OverviewCostCenter, OverviewUnit } from "@/lib/budget/overview";

export interface BudgetOverview {
  year: number;
  budget: { id: string; name: string } | null;
  /** When the year's ledger was last fetched from Fortnox, or null if never. */
  lastSyncAt: string | null;
  units: OverviewUnit[];
}

export async function getBudgetOverview(year: number): Promise<BudgetOverview> {
  const [budgetId, fyId, prefixes, costCenters] = await Promise.all([
    resolveBudget(year),
    financialYearIdForCalendarYear(year),
    getPrefixes(),
    prisma.costCenter.findMany({ select: { code: true, name: true } }),
  ]);

  const [budget, planned, booked, fy] = await Promise.all([
    budgetId
      ? prisma.budget.findUnique({
          where: { id: budgetId },
          select: { id: true, name: true },
        })
      : null,
    budgetId ? budgetComparison(budgetId) : null,
    fyId == null
      ? []
      : prisma.ledgerRow.groupBy({
          by: ["account", "costCenterCode"],
          where: { financialYear: fyId },
          _sum: { debit: true, credit: true },
        }),
    fyId == null
      ? null
      : prisma.fortnoxFinancialYear.findUnique({
          where: { id: fyId },
          select: { lastSyncAt: true },
        }),
  ]);

  const units = buildOverview(
    planned ?? [],
    booked.map((g) => ({
      account: g.account,
      costCenterCode: g.costCenterCode,
      debit: g._sum.debit ?? 0,
      credit: g._sum.credit ?? 0,
    })),
    (code) => resultUnitForCode(code, prefixes)?.resultUnitName ?? null,
    new Map(costCenters.map((c) => [c.code, c.name])),
  );

  return {
    year,
    budget: budget ?? null,
    lastSyncAt: fy?.lastSyncAt?.toISOString() ?? null,
    units,
  };
}
