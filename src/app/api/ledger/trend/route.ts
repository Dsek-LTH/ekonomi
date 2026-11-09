// The utfall shaped for charts: result month by month, per cost centre and by kind of cost
// (lib/ledger/trend). Separate from /api/ledger/report so it is fetched only when charts are shown.
// Both resolve the period through lib/ledger/period.ts. Result report only. Any signed-in user.

import { NextResponse } from "next/server";
import { gate } from "@/lib/api/guard";
import { periodOf, resolveLedgerPeriod } from "@/lib/ledger/period";
import { getLedgerTrend } from "@/lib/ledger/trend";
import { budgetComparison, resolveBudget } from "@/lib/ledger/comparison";

export async function GET(req: Request) {
  const g = await gate();
  if (!g.ok) return g.res;

  const url = new URL(req.url);
  const period = await resolveLedgerPeriod(url);
  if (!period) {
    return NextResponse.json({ year: null, period: null, trend: null, budget: null });
  }
  const { selected, from, to, costCenterCodes } = period;

  // Only when asked for: evaluating a budget runs the whole sheet.
  const wantsBudget = url.searchParams.get("compare") === "BUDGET";
  const budgetId = wantsBudget
    ? await resolveBudget(selected.year, url.searchParams.get("budget"))
    : null;
  const budget = budgetId ? await budgetComparison(budgetId) : null;

  const trend = await getLedgerTrend({
    financialYear: selected.id,
    from,
    to,
    costCenterCodes,
    budget,
  });

  return NextResponse.json({
    year: selected,
    period: periodOf(period),
    // The financial year's span, for pacing the period against the budget.
    yearPeriod: {
      from: selected.fromDate.slice(0, 7),
      to: selected.toDate.slice(0, 7),
    },
    trend,
    // Which budget the figures were paced against, null when none.
    budget: budget ? budgetId : null,
  });
}
