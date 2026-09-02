// The utfall, shaped for the charts rather than for the table: the result month
// by month, per cost centre, and by kind of cost. See lib/ledger/trend.
//
// A route of its own rather than more fields on /api/ledger/report, because the
// two are asked at different moments and cost different amounts. The table is
// what the page opens on; this is fetched when somebody switches to the charts,
// and never at all for a reader who does not.
//
// It takes the same parameters as the report and answers about the same period,
// so the two views cannot end up describing different things. Only the result
// report has a shape worth drawing: a balansrapport is a position, not a period,
// and its "months" would be twelve copies of the same balance sheet.
//
// Auth: any signed-in user, the same as the report it stands beside.
import { NextResponse } from "next/server";
import { gate } from "@/lib/api/guard";
import { getLedgerYears } from "@/lib/ledger";
import { getLedgerTrend } from "@/lib/ledger/trend";
import { budgetComparison, resolveBudget } from "@/lib/ledger/comparison";

// "YYYY-MM" → the month's first day (UTC). Falls back to `fallback`.
function monthStart(raw: string | null, fallback: Date): Date {
  const m = /^(\d{4})-(\d{2})$/.exec(raw ?? "");
  if (!m) return fallback;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1));
}

// "YYYY-MM" → the month's last day (UTC).
function monthEnd(raw: string | null, fallback: Date): Date {
  const m = /^(\d{4})-(\d{2})$/.exec(raw ?? "");
  if (!m) return fallback;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]), 0));
}

const clamp = (d: Date, lo: Date, hi: Date) => (d < lo ? lo : d > hi ? hi : d);

export async function GET(req: Request) {
  const g = await gate();
  if (!g.ok) return g.res;

  const url = new URL(req.url);
  const years = await getLedgerYears();
  const yearParam = Number(url.searchParams.get("year"));
  const selected = years.find((y) => y.id === yearParam) ?? years[0];

  if (!selected) {
    return NextResponse.json({ year: null, period: null, trend: null, budget: null });
  }

  const yearStart = new Date(`${selected.fromDate}T00:00:00Z`);
  const yearEnd = new Date(`${selected.toDate}T00:00:00Z`);
  const from = clamp(monthStart(url.searchParams.get("from"), yearStart), yearStart, yearEnd);
  const to = clamp(monthEnd(url.searchParams.get("to"), yearEnd), from, yearEnd);

  // `costCenter=` (empty) is the "no cost centre" bucket; absent means all.
  const ccParam = url.searchParams.get("costCenter");
  const costCenterCode = ccParam === null ? undefined : ccParam;

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
    costCenterCode,
    budget,
  });

  return NextResponse.json({
    year: selected,
    period: { from: from.toISOString().slice(0, 7), to: to.toISOString().slice(0, 7) },
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
