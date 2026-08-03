// Resultat- and balansrapport over the Fortnox ledger mirror. Returns the
// available financial years too, so the report page is self-contained.
// Auth: any signed-in user (it's the org's own accounting).
import { NextResponse } from "next/server";
import { gate } from "@/lib/api/guard";
import { getLedgerYears } from "@/lib/ledger";
import { getLedgerReport, type GroupMode } from "@/lib/ledger/report";
import {
  budgetComparison,
  budgetOptions,
  priorYearComparison,
  resolveBudget,
  type ComparisonMode,
} from "@/lib/ledger/comparison";
import type { ReportKind } from "@/lib/ledger/bas";

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
    return NextResponse.json({ years: [], year: null, report: null, comparison: "NONE" });
  }

  const kind: ReportKind = url.searchParams.get("kind") === "BALANCE" ? "BALANCE" : "RESULT";
  const group: GroupMode =
    url.searchParams.get("group") === "SPECIFIED" ? "SPECIFIED" : "SUMMED";
  const compareParam = url.searchParams.get("compare");
  const compare: ComparisonMode =
    compareParam === "PRIOR" || compareParam === "BUDGET" ? compareParam : "NONE";

  const yearStart = new Date(`${selected.fromDate}T00:00:00Z`);
  const yearEnd = new Date(`${selected.toDate}T00:00:00Z`);
  const from = clamp(monthStart(url.searchParams.get("from"), yearStart), yearStart, yearEnd);
  const to = clamp(monthEnd(url.searchParams.get("to"), yearEnd), from, yearEnd);

  // `costCenter=` (empty) is the "no cost centre" bucket; absent means all.
  const ccParam = url.searchParams.get("costCenter");
  const costCenterCode = ccParam === null ? undefined : ccParam;

  // Budget comparison only makes sense for the result report — balance-sheet
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
    period: { from: from.toISOString().slice(0, 7), to: to.toISOString().slice(0, 7) },
    report,
    // What was actually applied — asking for a comparison that has no data
    // (an unsynced prior year, a year with no budget) reports back as NONE.
    comparison: comparisonApplied,
    comparisonRequested: compare,
    budgets,
    budget,
  });
}
