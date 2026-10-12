// The utfall, shaped for the charts rather than for the table: the result month
// by month, per cost centre, and by kind of cost. See lib/ledger/trend.
//
// A route of its own rather than more fields on /api/ledger/report, because the
// two are asked at different moments and cost different amounts. The table is
// what the page opens on; this is fetched when somebody switches to the charts,
// and never at all for a reader who does not.
//
// It takes the same parameters as the report and answers about the same period,
// so the two views cannot end up describing different things. That is not a
// convention here: both resolve the period through lib/ledger/period.ts, which
// is the one place the year lookup and the month clamping live. Only the result
// report has a shape worth drawing: a balansrapport is a position, not a period,
// and its "months" would be twelve copies of the same balance sheet.
//
// Auth: any signed-in user, the same as the report it stands beside.
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

  // Only when asked for, the same as the report's comparison: evaluating a
  // budget means reading and running the whole sheet, and most readings of
  // these charts do not want it.
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
    // The financial year's own span, so the charts can say where the period
    // they were given sits inside it. The budget is a whole year's figure and
    // a chart pacing against it needs to know how long the year is.
    yearPeriod: {
      from: selected.fromDate.slice(0, 7),
      to: selected.toDate.slice(0, 7),
    },
    trend,
    // Which budget the figures were paced against, null when none was applied.
    budget: budget ? budgetId : null,
  });
}
