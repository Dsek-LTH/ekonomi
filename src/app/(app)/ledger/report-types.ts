// The shapes /api/ledger/report and /api/ledger/rows return, plus the two kinds
// of narrowing the page does. Shared by the client, its toolbar and its tables.
import type { ReportKind } from "@/lib/ledger/bas";

// The report itself is shaped by the server that builds it. Re-exported
// rather than restated so this file keeps being the one import the ledger
// screen needs, without being a second opinion about what a report is.
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
 * The figure columns a result report can show, in the order they stand.
 *
 *   period            the period itself
 *   prior             the same days a year earlier
 *   accumulated       the year so far, up to the period's end
 *   priorAccumulated  the prior year so far, up to a year before that
 *   priorDiff         the period against the same days a year earlier
 *
 * Picked by the reader in any order and always drawn in this one, so two
 * readers who picked the same set are looking at the same table.
 */
export type ResultColumn = "period" | "prior" | "accumulated" | "priorAccumulated" | "priorDiff";
export const RESULT_COLUMNS: readonly ResultColumn[] = [
  "period",
  "prior",
  "accumulated",
  "priorAccumulated",
  "priorDiff",
];
/** Whether any picked column needs last year's figures fetched. */
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

// What the report is asked of the server. Every field here is a query param, so
// changing one refetches.
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
  // Fetch last year's figures for the prior-year columns. Derived from the
  // picked columns (see needsPriorYear), and held here because it is a
  // question for the server; the columns themselves are only presentation.
  prior: boolean;
}

// How the fetched report is narrowed and presented on screen. These need no
// round-trip: the report is already in memory, so they apply instantly.
export interface ViewOptions {
  // Show the difference against the comparison column. Off by default: the
  // comparison itself is what most readings need, and the extra column costs
  // width the account names would rather have.
  diff: boolean;
}

export const EMPTY_VIEW: ViewOptions = {
  diff: false,
};
