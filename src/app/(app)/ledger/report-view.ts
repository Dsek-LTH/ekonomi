// The figures the report is read by, and turning it into a CSV.
import type { LedgerReport, ReportAccount, ResultColumn } from "./report-types";
import { RESULT_COLUMNS } from "./report-types";

// The figure a line is read by: the period's movement on a result report, the
// closing balance on a balance one. What a comparison is taken against, and
// split in two because an account calls it `amount` and a total `total`.
export const rowValue = (a: ReportAccount, isBalance: boolean) =>
  isBalance ? a.closing ?? 0 : a.amount;

export const totalValue = (
  x: { total: number; closing: number | null },
  isBalance: boolean,
) => (isBalance ? x.closing ?? 0 : x.total);


// Surplus or deficit. Only for figures that are a *result*: the bottom line
// and a cost centre's own total, which are the only places in this report where
// the sign says good or bad news. Account and section amounts are deliberately
// left alone: every cost section is credit-oriented (see lib/ledger/bas.ts), so its
// lines are negative by construction, and colouring them red would say
// "something is wrong here" about an ordinary invoice.
export const resultTone = (value: number) =>
  value > 0 ? "text-success" : value < 0 ? "text-danger" : "";

// toFixed's "-" is the ASCII hyphen; every amount beside it is formatted by
// Intl, which uses a true minus (U+2212). Two different minus signs in one row
// look like a rendering fault.
export function formatPercent(fraction: number | null, digits = 1): string {
  if (fraction == null || !Number.isFinite(fraction)) return "";
  return `${(fraction * 100).toFixed(digits).replace(".", ",").replace("-", "−")} %`;
}

// Excel in a Swedish locale expects ";" between fields and "," inside numbers,
// and needs the BOM to read non-ASCII letters as anything but mojibake.
const cell = (v: string | number | null | undefined): string => {
  if (v == null) return "";
  const s = typeof v === "number" ? v.toFixed(2).replace(".", ",") : v;
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** A translator scoped to the `ledger` namespace, see LedgerClient. */
type Labels = (key: string) => string;

export function reportToCsv(
  report: LedgerReport,
  opts: {
    specified: boolean;
    showComparison: boolean;
    comparisonLabel: string;
    diff: boolean;
    /** The result report's figure columns. Ignored on a balance report. */
    columns: readonly ResultColumn[];
    /** Column headings and section names, in the reader's language. */
    t: Labels;
  },
): string {
  const { t } = opts;
  const isBalance = report.kind === "BALANCE";
  const showDiff = opts.showComparison && opts.diff;
  // The same pick, in the same order, as the table on screen. With nothing
  // picked, the period, as there.
  const picked = RESULT_COLUMNS.filter((c) => opts.columns.includes(c));
  const resultCols: readonly ResultColumn[] = isBalance ? [] : picked.length ? picked : ["period"];
  const resultHead = (c: ResultColumn) => (c === "period" ? t("csv.amount") : t(`csv.${c}`));
  // One line's figures for those columns. The period is passed in because an
  // account calls it `amount` and a total `total`.
  const resultCells = (
    x: { accumulated: number | null; prior: number | null; priorAccumulated: number | null },
    period: number,
  ) =>
    resultCols.map((c) =>
      c === "period"
        ? period
        : c === "priorDiff"
          ? x.prior == null
            ? null
            : period - x.prior
          : x[c],
    );
  const head = [
    ...(opts.specified ? [t("csv.costCenter"), t("csv.costCenterName")] : []),
    t("csv.section"),
    t("csv.account"),
    t("csv.accountName"),
    ...(isBalance ? [t("csv.opening"), t("csv.period"), t("csv.closing")] : []),
    ...resultCols.map(resultHead),
    ...(opts.showComparison ? [opts.comparisonLabel] : []),
    ...(showDiff ? [t("csv.difference")] : []),
  ];

  const lines = [head.map(cell).join(";")];
  const push = (cells: (string | number | null)[]) => lines.push(cells.map(cell).join(";"));

  for (const g of report.groups) {
    const cc = opts.specified
      ? [g.costCenterCode ?? t("noCostCenter"), g.costCenterName ?? ""]
      : [];
    for (const s of g.sections) {
      for (const a of s.accounts) {
        const value = rowValue(a, isBalance);
        push([
          ...cc,
          t(`section.${s.key}`),
          a.account,
          a.accountName,
          ...(isBalance ? [a.opening ?? 0, a.amount, a.closing ?? 0] : []),
          ...resultCells(a, a.amount),
          ...(opts.showComparison ? [a.comparison] : []),
          ...(showDiff ? [a.comparison == null ? null : value - a.comparison] : []),
        ]);
      }
      push([
        ...cc,
        t(`section.${s.key}`),
        "",
        t(`sectionTotal.${s.key}`),
        ...(isBalance ? [s.opening ?? 0, s.total, s.closing ?? 0] : []),
        ...resultCells(s, s.total),
        ...(opts.showComparison ? [s.comparison] : []),
        ...(showDiff
          ? [s.comparison == null ? null : totalValue(s, isBalance) - s.comparison]
          : []),
      ]);
    }
  }

  push([
    ...(opts.specified ? ["", ""] : []),
    "",
    "",
    t("csv.total"),
    ...(isBalance ? [report.opening ?? 0, report.total, report.closing ?? 0] : []),
    ...resultCells(report, report.total),
    ...(opts.showComparison ? [report.comparison] : []),
    ...(showDiff
      ? [
          report.comparison == null
            ? null
            : totalValue(report, isBalance) - report.comparison,
        ]
      : []),
  ]);

  return `﻿${lines.join("\r\n")}\r\n`;
}

export function downloadCsv(filename: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
