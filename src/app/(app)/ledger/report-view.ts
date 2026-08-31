// Narrowing the fetched report on screen, and turning what's on screen into a
// CSV. Both work off the same filtered report, so an export always contains
// exactly the rows the viewer was looking at.
import type {
  LedgerReport,
  ReportAccount,
  ReportGroup,
  ReportSection,
  ViewOptions,
} from "./report-types";

// Sum a nullable column: null only when every input is null, so a report
// without opening balances keeps them null rather than turning them into 0.
function sumOf<T>(xs: T[], get: (x: T) => number | null): number | null {
  return xs.every((x) => get(x) == null)
    ? null
    : xs.reduce((s, x) => s + (get(x) ?? 0), 0);
}

const countAccounts = (r: LedgerReport) =>
  r.groups.reduce((n, g) => n + g.sections.reduce((m, s) => m + s.accounts.length, 0), 0);

// An account with nothing worth a line. The server already drops the entirely
// empty ones (no movement, no opening, no comparison); this is what the "hide
// zero rows" toggle means on top of that: on a result report an account that
// didn't move in the period (a budgeted line still at zero, say), and on a
// balance report only one that has no balance on either side of it either,
// since a standing balance with no movement is exactly what that report is for.
function isZeroRow(a: ReportAccount, isBalance: boolean): boolean {
  return isBalance
    ? a.amount === 0 && (a.opening ?? 0) === 0 && (a.closing ?? 0) === 0
    : a.amount === 0;
}

export interface FilteredReport {
  report: LedgerReport;
  shown: number;
  total: number;
  filtered: boolean;
}

// Apply the on-screen narrowing. Sections and groups that end up empty are
// dropped, and every total is recomputed from the rows that remain: a report
// whose visible lines don't add up to its own totals is worse than one that
// shows fewer lines, and the aggregation mirrors the server's exactly (section
// = Σ accounts, group = Σ sections, report = Σ groups).
export function filterReport(report: LedgerReport, view: ViewOptions): FilteredReport {
  const q = view.query.trim().toLowerCase();
  const total = countAccounts(report);
  if (!q && !view.hideZero) return { report, shown: total, total, filtered: false };

  const isBalance = report.kind === "BALANCE";
  const keep = (a: ReportAccount) =>
    (!q ||
      a.account.toLowerCase().includes(q) ||
      a.accountName.toLowerCase().includes(q)) &&
    (!view.hideZero || !isZeroRow(a, isBalance));

  const groups: ReportGroup[] = [];
  for (const g of report.groups) {
    const sections: ReportSection[] = [];
    for (const s of g.sections) {
      const accounts = s.accounts.filter(keep);
      if (accounts.length === 0) continue;
      sections.push({
        ...s,
        accounts,
        total: accounts.reduce((sum, a) => sum + a.amount, 0),
        opening: sumOf(accounts, (a) => a.opening),
        closing: sumOf(accounts, (a) => a.closing),
        comparison: sumOf(accounts, (a) => a.comparison),
      });
    }
    if (sections.length === 0) continue;
    groups.push({
      ...g,
      sections,
      total: sections.reduce((sum, s) => sum + s.total, 0),
      opening: sumOf(sections, (s) => s.opening),
      closing: sumOf(sections, (s) => s.closing),
      comparison: sumOf(sections, (s) => s.comparison),
    });
  }

  return {
    report: {
      ...report,
      groups,
      total: groups.reduce((sum, g) => sum + g.total, 0),
      opening: sumOf(groups, (g) => g.opening),
      closing: sumOf(groups, (g) => g.closing),
      comparison: sumOf(groups, (g) => g.comparison),
    },
    shown: countAccounts({ ...report, groups }),
    total,
    filtered: true,
  };
}

// The figure a line is read by: the period's movement on a result report, the
// closing balance on a balance one. Used for both the share and the comparison,
// and split in two because an account calls it `amount` and a total `total`.
export const rowValue = (a: ReportAccount, isBalance: boolean) =>
  isBalance ? a.closing ?? 0 : a.amount;

export const totalValue = (
  x: { total: number; closing: number | null },
  isBalance: boolean,
) => (isBalance ? x.closing ?? 0 : x.total);

// A row's share of its section, as a fraction. Null when the section nets to
// zero. A share of an empty total is a division no one can act on.
export function share(part: number, whole: number): number | null {
  return whole === 0 ? null : part / whole;
}

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
    share: boolean;
    diff: boolean;
    /** Column headings and section names, in the reader's language. */
    t: Labels;
  },
): string {
  const { t } = opts;
  const isBalance = report.kind === "BALANCE";
  const showDiff = opts.showComparison && opts.diff;
  const head = [
    ...(opts.specified ? [t("csv.costCenter"), t("csv.costCenterName")] : []),
    t("csv.section"),
    t("csv.account"),
    t("csv.accountName"),
    ...(isBalance ? [t("csv.opening")] : []),
    isBalance ? t("csv.period") : t("csv.amount"),
    ...(isBalance ? [t("csv.closing")] : []),
    ...(opts.showComparison ? [opts.comparisonLabel] : []),
    ...(showDiff ? [t("csv.difference")] : []),
    ...(opts.share ? [t("csv.share")] : []),
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
          ...(isBalance ? [a.opening ?? 0] : []),
          a.amount,
          ...(isBalance ? [a.closing ?? 0] : []),
          ...(opts.showComparison ? [a.comparison] : []),
          ...(showDiff ? [a.comparison == null ? null : value - a.comparison] : []),
          ...(opts.share
            ? [formatPercent(share(value, totalValue(s, isBalance)))]
            : []),
        ]);
      }
      push([
        ...cc,
        t(`section.${s.key}`),
        "",
        t(`sectionTotal.${s.key}`),
        ...(isBalance ? [s.opening ?? 0] : []),
        s.total,
        ...(isBalance ? [s.closing ?? 0] : []),
        ...(opts.showComparison ? [s.comparison] : []),
        ...(showDiff
          ? [s.comparison == null ? null : totalValue(s, isBalance) - s.comparison]
          : []),
        ...(opts.share ? [""] : []),
      ]);
    }
  }

  push([
    ...(opts.specified ? ["", ""] : []),
    "",
    "",
    t("csv.total"),
    ...(isBalance ? [report.opening ?? 0] : []),
    report.total,
    ...(isBalance ? [report.closing ?? 0] : []),
    ...(opts.showComparison ? [report.comparison] : []),
    ...(showDiff
      ? [
          report.comparison == null
            ? null
            : totalValue(report, isBalance) - report.comparison,
        ]
      : []),
    ...(opts.share ? [""] : []),
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
