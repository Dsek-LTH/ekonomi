import type { ReportKind } from "@/lib/ledger/bas";

// Re-exported so this file stays the one import the ledger screen needs.
export type {
  GroupMode,
  LedgerReport,
  ReportAccount,
  ReportGroup,
  ReportSection,
} from "@/lib/ledger/report-shape";
import type { GroupMode, LedgerReport } from "@/lib/ledger/report-shape";
export type ComparisonMode = "NONE" | "PRIOR" | "BUDGET";

/**
 * The figure columns a result report can show, always drawn in this order. `prior` is the same days a year
 * earlier, `priorAccumulated` the prior year so far, `priorDiff` the period against `prior`.
 */
export type ResultColumn = "period" | "prior" | "accumulated" | "priorAccumulated" | "priorDiff";
export const RESULT_COLUMNS: readonly ResultColumn[] = [
  "period",
  "prior",
  "accumulated",
  "priorAccumulated",
  "priorDiff",
];
export const needsPriorYear = (cols: readonly ResultColumn[]) =>
  cols.some((c) => c === "prior" || c === "priorAccumulated" || c === "priorDiff");

export interface LedgerYear {
  id: number;
  year: number;
  lastSyncAt: string | null;
  fromDate: string;
  toDate: string;
}

export interface BudgetOption {
  id: string;
  year: number; // its own, not necessarily the year being reported on
  name: string;
  locked: boolean; // sealed, so almost always the adopted one
}

export interface ReportResponse {
  years: LedgerYear[];
  year: LedgerYear | null;
  period: { from: string; to: string } | null;
  /** The period as YYYY-MM-DD days. Absent when there is no year to report on. */
  periodDates?: { from: string; to: string };
  /** For the printed header. See reportMeta in /api/ledger/report. */
  meta?: { companyName: string | null; orgNumber: string | null; latestVouchers: string[] };
  report: LedgerReport | null;
  comparison: ComparisonMode;
  comparisonRequested: ComparisonMode;
  /** Null unless last year's columns were asked for; false when it isn't synced. */
  priorAvailable?: boolean | null;
  // Every budget of every year, and the one the report was actually compared
  // against (null unless a budget comparison was applied).
  budgets: BudgetOption[];
  budget: string | null;
}

export interface RowView {
  id: string;
  date: string;
  voucher: string;
  description: string;
  text: string | null;
  costCenter: string | null;
  debit: number;
  credit: number;
}

// What the report is asked of the server: every field is a query param, so changing one refetches.
export interface QueryState {
  kind: ReportKind;
  year: number | null;
  from: string | null; // "YYYY-MM-DD"
  to: string | null;
  // Which cost centres. Empty = every one; otherwise only these codes, with ""
  // among them for the rows carrying none. Sent as repeated `costCenter`
  // params; see lib/ledger/cost-center-filter.ts.
  costCenters: string[];
  group: GroupMode;
  compare: ComparisonMode;
  // Which budget to compare against, any of them, of any year. Null lets the
  // server pick this year's; only meaningful when compare is BUDGET.
  budget: string | null;
  // Fetch last year's figures for the prior-year columns; derived from the picked columns (needsPriorYear).
  prior: boolean;
}

// How the fetched report is narrowed and presented on screen, applied instantly in memory.
export interface ViewOptions {
  // Show the difference against the comparison column (off by default: it costs width).
  diff: boolean;
}

export const EMPTY_VIEW: ViewOptions = {
  diff: false,
};
