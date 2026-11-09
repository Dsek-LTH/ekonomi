import type { LedgerReport, ReportAccount, ResultColumn } from "./report-types";
import { RESULT_COLUMNS } from "./report-types";

// The figure a line is read by: period movement on a result report, closing balance on a balance one.
export const rowValue = (a: ReportAccount, isBalance: boolean) =>
  isBalance ? (a.closing ?? 0) : a.amount;

export const totalValue = (x: { total: number; closing: number | null }, isBalance: boolean) =>
  isBalance ? (x.closing ?? 0) : x.total;

// Surplus or deficit, only for *result* figures (bottom line, a cost centre's total). Account and section amounts
// are credit-oriented (lib/ledger/bas.ts), negative by construction, so colouring them would signal a false problem.
export const resultTone = (value: number) =>
  value > 0 ? "text-success" : value < 0 ? "text-danger" : "";

// toFixed's "-" is the ASCII hyphen but Intl uses a true minus (U+2212); two minus signs in one row look like a fault.
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

type Labels = (key: string) => string;

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
    t: Labels;
  },
): string {
  const { t } = opts;
  const isBalance = report.kind === "BALANCE";
  const showDiff = opts.showComparison && opts.diff;
  const picked = RESULT_COLUMNS.filter((c) => opts.columns.includes(c));
  const resultCols: readonly ResultColumn[] = isBalance ? [] : picked.length ? picked : ["period"];

  // One result column's figure for a line; the period is passed in since an account calls it `amount` and a total `total`.
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

  // Every figure column of one line in header order, the same for accounts, sections and the report.
  const figures = (x: Figures, period: number) => {
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
  push([
    ...(opts.specified ? ["", ""] : []),
    "",
    "",
    t("csv.total"),
    ...figures(report, report.total),
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
