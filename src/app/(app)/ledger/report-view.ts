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

/** The figures every line of the report carries, account and total alike. */
type Figures = Pick<
  ReportAccount,
  "opening" | "closing" | "comparison" | "accumulated" | "prior" | "priorAccumulated"
>;

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

  // One result column's figure for a line. The period is passed in because an
  // account calls it `amount` and a total `total`.
  const resultCell = (c: ResultColumn, x: Figures, period: number) => {
    switch (c) {
      case "period":
        return period;
      case "priorDiff":
        return x.prior == null ? null : period - x.prior;
      default:
        return x[c];
    }
  };

  // Every figure column of one line, in the header's order. The same for an
  // account, a section's total and the report's, which is the point: the three
  // kinds of row cannot come to disagree about what a column holds.
  const figures = (x: Figures, period: number) => {
    // What a comparison is taken against: the period's movement on a result
    // report, the closing balance on a balance one. See rowValue.
    const value = isBalance ? (x.closing ?? 0) : period;
    return [
      ...(isBalance ? [x.opening ?? 0, period, x.closing ?? 0] : []),
      ...resultCols.map((c) => resultCell(c, x, period)),
      ...(opts.showComparison ? [x.comparison] : []),
      ...(showDiff ? [x.comparison == null ? null : value - x.comparison] : []),
    ];
  };

  const head = [
    ...(opts.specified ? [t("csv.costCenter"), t("csv.costCenterName")] : []),
    t("csv.section"),
    t("csv.account"),
    t("csv.accountName"),
    ...(isBalance ? [t("csv.opening"), t("csv.period"), t("csv.closing")] : []),
    ...resultCols.map((c) => (c === "period" ? t("csv.amount") : t(`csv.${c}`))),
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
      const name = t(`section.${s.key}`);
      for (const a of s.accounts) {
        push([...cc, name, a.account, a.accountName, ...figures(a, a.amount)]);
      }
      push([...cc, name, "", t(`sectionTotal.${s.key}`), ...figures(s, s.total)]);
    }
  }
  push([...(opts.specified ? ["", ""] : []), "", "", t("csv.total"), ...figures(report, report.total)]);

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
