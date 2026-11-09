// The shape a ledger report has on the wire, shared by the server (report.ts) and the browser ledger screen.
// Imports only the BAS vocabulary so client files do not pull in the query layer.
import type { ReportKind } from "./bas";

/** SUMMED sums the cost centres away; SPECIFIED groups by them. */
export type GroupMode = "SUMMED" | "SPECIFIED";

export interface ReportAccount {
  account: string;
  accountName: string;
  amount: number; // SEK, oriented, period movement
  opening: number | null; // SEK, oriented, balance report only
  closing: number | null; // SEK, oriented, balance report only
  comparison: number | null; // SEK, oriented, prior year or budget
  /** SEK, oriented: the financial year's start to the period's end. Result report only. */
  accumulated: number | null;
  /** SEK, oriented: the same days a year earlier. Null unless asked for (`prior=1`). */
  prior: number | null;
  /** SEK, oriented: the prior year's start to a year before the period's end. As `prior`. */
  priorAccumulated: number | null;
}

export interface ReportSection {
  /** Names the section in messages (`ledger.section.<key>`, see BasSection). */
  key: string;
  accounts: ReportAccount[];
  total: number;
  opening: number | null;
  closing: number | null;
  comparison: number | null;
  /** SEK, oriented: the financial year's start to the period's end. Result report only. */
  accumulated: number | null;
  /** SEK, oriented: the same days a year earlier. Null unless asked for (`prior=1`). */
  prior: number | null;
  /** SEK, oriented: the prior year's start to a year before the period's end. As `prior`. */
  priorAccumulated: number | null;
}

/** One per cost centre in SPECIFIED mode; a single unnamed group in SUMMED. */
export interface ReportGroup {
  costCenterCode: string | null;
  costCenterName: string | null;
  sections: ReportSection[];
  total: number;
  opening: number | null;
  closing: number | null;
  comparison: number | null;
  /** SEK, oriented: the financial year's start to the period's end. Result report only. */
  accumulated: number | null;
  /** SEK, oriented: the same days a year earlier. Null unless asked for (`prior=1`). */
  prior: number | null;
  /** SEK, oriented: the prior year's start to a year before the period's end. As `prior`. */
  priorAccumulated: number | null;
}

export interface LedgerReport {
  kind: ReportKind;
  group: GroupMode;
  groups: ReportGroup[];
  total: number;
  opening: number | null;
  closing: number | null;
  comparison: number | null;
  /** SEK, oriented: the financial year's start to the period's end. Result report only. */
  accumulated: number | null;
  /** SEK, oriented: the same days a year earlier. Null unless asked for (`prior=1`). */
  prior: number | null;
  /** SEK, oriented: the prior year's start to a year before the period's end. As `prior`. */
  priorAccumulated: number | null;
}
