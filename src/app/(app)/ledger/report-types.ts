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

export interface LedgerYear {
  id: number;
  year: number;
  lastSyncAt: string | null;
  fromDate: string;
  toDate: string;
}


export interface BudgetOption {
  id: string;
  year: number; // its own — not necessarily the year being reported on
  name: string;
  locked: boolean; // sealed, so almost always the adopted one
}

export interface ReportResponse {
  years: LedgerYear[];
  year: LedgerYear | null;
  period: { from: string; to: string } | null;
  report: LedgerReport | null;
  comparison: ComparisonMode;
  comparisonRequested: ComparisonMode;
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
  from: string | null; // "YYYY-MM"
  to: string | null;
  // null = every cost centre, "" = the rows carrying none, otherwise a code.
  costCenter: string | null;
  group: GroupMode;
  compare: ComparisonMode;
  // Which budget to compare against — any of them, of any year. Null lets the
  // server pick this year's; only meaningful when compare is BUDGET.
  budget: string | null;
}

// How the fetched report is narrowed and presented on screen. These need no
// round-trip: the report is already in memory, so they apply instantly.
export interface ViewOptions {
  query: string; // account number or name
  hideZero: boolean; // drop accounts with nothing in the period
  share: boolean; // show each account's share of its section
  // Show the difference against the comparison column. Off by default: the
  // comparison itself is what most readings need, and the extra column costs
  // width the account names would rather have.
  diff: boolean;
}

export const EMPTY_VIEW: ViewOptions = {
  query: "",
  hideZero: false,
  share: false,
  diff: false,
};
