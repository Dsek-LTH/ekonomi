// Resultat- and balansrapport over the Fortnox ledger mirror. Returns the
// available financial years too, so the report page is self-contained.
// Auth: any signed-in user (it's the org's own accounting).
//
// The period comes from lib/ledger/period.ts, shared with /api/ledger/trend so
// the table and the charts cannot end up describing different spans.
import { NextResponse } from "next/server";
import { gate } from "@/lib/api/guard";
import { periodOf, resolveLedgerPeriod } from "@/lib/ledger/period";
import { getLedgerReport, type GroupMode } from "@/lib/ledger/report";
import {
  budgetComparison,
  budgetOptions,
  priorYearComparison,
  resolveBudget,
  type ComparisonMode,
} from "@/lib/ledger/comparison";
import type { ReportKind } from "@/lib/ledger/bas";

export async function GET(req: Request) {
  const g = await gate();
  if (!g.ok) return g.res;

  const url = new URL(req.url);
  const period = await resolveLedgerPeriod(url);
  if (!period) {
    return NextResponse.json({ years: [], year: null, report: null, comparison: "NONE" });
  }
  const { years, selected, yearStart, from, to, costCenterCode } = period;

  const kind: ReportKind = url.searchParams.get("kind") === "BALANCE" ? "BALANCE" : "RESULT";
  const group: GroupMode =
    url.searchParams.get("group") === "SPECIFIED" ? "SPECIFIED" : "SUMMED";
  const compareParam = url.searchParams.get("compare");
  const compare: ComparisonMode =
    compareParam === "PRIOR" || compareParam === "BUDGET" ? compareParam : "NONE";

  // Budget comparison only makes sense for the result report. Balance-sheet
  // accounts aren’t budgeted. The caller may name which budget to compare
  // against, and it need not be one of this year’s (see budgetOptions); the
  // whole list travels back either way, since that is what the report page
  // builds its picker from.
  const budgets = kind === "RESULT" ? await budgetOptions() : [];
  let comparison: Map<string, number> | null = null;
  let comparisonApplied: ComparisonMode = "NONE";
  let budget: string | null = null;
  if (compare === "PRIOR") {
    comparison = await priorYearComparison(selected.id, from, to, yearStart);
    if (comparison) comparisonApplied = "PRIOR";
  } else if (compare === "BUDGET" && kind === "RESULT") {
    budget = await resolveBudget(selected.year, url.searchParams.get("budget"));
    comparison = budget ? await budgetComparison(budget) : null;
    if (comparison) comparisonApplied = "BUDGET";
    else budget = null;
  }

  const report = await getLedgerReport({
    financialYear: selected.id,
    kind,
    from,
    to,
    yearStart,
    costCenterCode,
    group,
    comparison,
  });

  return NextResponse.json({
    years,
    year: selected,
    period: periodOf(period),
    report,
    // What was actually applied: asking for a comparison that has no data
    // (an unsynced prior year, a year with no budget) reports back as NONE.
    comparison: comparisonApplied,
    comparisonRequested: compare,
    budgets,
    budget,
  });
}
