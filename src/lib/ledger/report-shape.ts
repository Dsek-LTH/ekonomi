// The shape a ledger report has on the wire.
//
// Its own module because both ends need it and neither may own it. The server
// builds these (lib/ledger/report.ts, which reaches for Prisma) and the ledger
// screen renders them (app/(app)/ledger/, which runs in the browser), so the
// definitions used to be written out twice, once on each side, identically and
// with nothing holding them together. A field added to the server's copy left
// the client's compiling perfectly against a shape the server had stopped
// sending.
//
// Nothing here imports anything but the BAS vocabulary, so a client file can
// take these without pulling the query layer along behind them.
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
}

export interface ReportSection {
  /** Names the section in messages (`ledger.section.<key>`, see BasSection). */
  key: string;
  accounts: ReportAccount[];
  total: number;
  opening: number | null;
  closing: number | null;
  comparison: number | null;
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
}

export interface LedgerReport {
  kind: ReportKind;
  group: GroupMode;
  groups: ReportGroup[];
  total: number;
  opening: number | null;
  closing: number | null;
  comparison: number | null;
}
