// Resultat- and balansrapport over the Fortnox ledger mirror, plus the available financial years.
// Any signed-in user. The period comes from lib/ledger/period.ts, shared with /api/ledger/trend.

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
import { isoDay } from "@/lib/domain/date";

/** What the printed report's header says: company, org number and the last voucher per series ("A495 B123"). */
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
    // The whole shape the page reads, empty (it reaches for `budgets` regardless).
    return NextResponse.json({
      years: [],
      year: null,
      period: null,
      report: null,
      comparison: "NONE",
      comparisonRequested: "NONE",
      budgets: [],
      budget: null,
    });
  }
  const { years, selected, yearStart, from, to, costCenterCodes } = period;

  const kind: ReportKind = url.searchParams.get("kind") === "BALANCE" ? "BALANCE" : "RESULT";
  const group: GroupMode = url.searchParams.get("group") === "SPECIFIED" ? "SPECIFIED" : "SUMMED";
  const compareParam = url.searchParams.get("compare");
  const compare: ComparisonMode =
    compareParam === "PRIOR" || compareParam === "BUDGET" ? compareParam : "NONE";

  // Budget comparison is for the result report only. The named budget need not be this year's
  // (see budgetOptions); the whole list travels back for the picker.
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

  // Last year's figures as extra columns (`prior=1`), result report only: the period's own days and
  // its year so far.
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
    // The period as days, for the printed header.
    periodDates: {
      from: isoDay(period.from),
      to: isoDay(period.to),
    },
    meta,
    report,
    // What was applied: a comparison with no data reports back as NONE.
    comparison: comparisonApplied,
    comparisonRequested: compare,
    // False when last year's columns were asked for and the prior year is not synced.
    priorAvailable: wantsPrior ? prior != null : null,
    budgets,
    budget,
  });
}
