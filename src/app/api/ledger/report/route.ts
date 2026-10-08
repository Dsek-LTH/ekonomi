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
import { prisma } from "@/lib/server/db";

/**
 * What the printed report's header says about where it came from, as Fortnox
 * prints it: the company, its org number, and the last voucher in each series
 * of the year ("A495 B123"), which is how a reader tells how far the books had
 * got when the report was taken.
 */
async function reportMeta(financialYear: number) {
  const [conn, latest] = await Promise.all([
    prisma.fortnoxConnection.findFirst({
      orderBy: { createdAt: "desc" },
      select: { companyName: true, orgNumber: true },
    }),
    prisma.ledgerVoucher.groupBy({
      by: ["series"],
      where: { financialYear },
      _max: { number: true },
      orderBy: { series: "asc" },
    }),
  ]);
  return {
    companyName: conn?.companyName ?? null,
    orgNumber: conn?.orgNumber ?? null,
    latestVouchers: latest.map((v) => `${v.series}${v._max.number ?? ""}`),
  };
}

export async function GET(req: Request) {
  const g = await gate();
  if (!g.ok) return g.res;

  const url = new URL(req.url);
  const period = await resolveLedgerPeriod(url);
  if (!period) {
    return NextResponse.json({ years: [], year: null, report: null, comparison: "NONE" });
  }
  const { years, selected, yearStart, from, to, costCenterCodes } = period;

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

  // Last year's figures as columns of their own (Period föregående år and the
  // rest), asked for with `prior=1`. Result report only: the balance report's
  // prior year is its comparison above. Two windows of the prior year: the
  // period's own days, and its year so far.
  const wantsPrior = kind === "RESULT" && url.searchParams.get("prior") === "1";
  const [prior, priorAccumulated] = wantsPrior
    ? await Promise.all([
        priorYearComparison(selected.id, from, to, yearStart),
        priorYearComparison(selected.id, yearStart, to, yearStart),
      ])
    : [null, null];

  const [report, meta] = await Promise.all([
    getLedgerReport({
      financialYear: selected.id,
      kind,
      from,
      to,
      yearStart,
      costCenterCodes,
      group,
      comparison,
      prior,
      priorAccumulated,
    }),
    reportMeta(selected.id),
  ]);

  return NextResponse.json({
    years,
    year: selected,
    period: periodOf(period),
    // The period as days, for the printed header ("2026-01-01 – 2026-03-31").
    periodDates: {
      from: period.from.toISOString().slice(0, 10),
      to: period.to.toISOString().slice(0, 10),
    },
    meta,
    report,
    // What was actually applied: asking for a comparison that has no data
    // (an unsynced prior year, a year with no budget) reports back as NONE.
    comparison: comparisonApplied,
    comparisonRequested: compare,
    // Whether last year's columns could be filled: false when they were asked
    // for and the prior year is not synced.
    priorAvailable: wantsPrior ? prior != null : null,
    budgets,
    budget,
  });
}
