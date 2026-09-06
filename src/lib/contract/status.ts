// Where a contract stands, as a reader sees it.
//
// The database stores five states (prisma/schema/contract.prisma) and a screen
// shows six. The extra one is EXPIRED, and it is deliberately not a column.
//
// An expiry is a fact about today, not a decision anybody took. Stored, it
// would need a job to run every night, and the morning that job did not run
// every screen in the app would quietly say a lapsed contract is still in
// force. Derived, the same row answers correctly on any day it is read and
// there is nothing to keep in step. The cost is that "expired" cannot be a
// `where` clause on its own, which is why the query filters on `validTo`
// instead: see lib/data/contracts.ts.
import type { Tone } from "@/lib/domain/status";
import type { ContractStatus } from "@/lib/domain/types";

/** The stored states plus the derived one. What a status pill renders. */
export type ContractDisplayStatus = ContractStatus | "EXPIRED";

/**
 * Whether a contract has run out, as of `today`.
 *
 * Only a SIGNED contract can expire. A draft with a date in the past is a draft
 * somebody abandoned, and calling it expired would put it in the list of things
 * that need renewing, which is exactly where it does not belong. A terminated
 * or cancelled one has already ended, and the reason it ended is the more
 * useful thing to say.
 *
 * Dates are ISO days ("2026-09-06"), compared as strings. That works because
 * ISO days sort lexically, and it avoids a timezone: `validTo` is a DATE
 * column, so the day it names is the same day everywhere, and turning it into
 * an instant to compare is how a contract expires an evening early in Sweden.
 */
export function isExpired(
  contract: { status: ContractStatus; validTo: string | null },
  today: string,
): boolean {
  if (contract.status !== "SIGNED") return false;
  if (contract.validTo === null) return false;
  return contract.validTo < today;
}

/** The status to show, expiry included. */
export function displayStatus(
  contract: { status: ContractStatus; validTo: string | null },
  today: string,
): ContractDisplayStatus {
  return isExpired(contract, today) ? "EXPIRED" : contract.status;
}

/**
 * Whether the rental terms may still be changed: the gear, the dates, the
 * price.
 *
 * Only while it is a draft. Once a contract has gone out for signature, the
 * counterparty is reading a document, and changing what it says underneath
 * them is the one edit that must not be possible. After it is signed, the
 * signed PDF is the agreement and no row in this database can amend it.
 *
 * Deliberately narrower than editing the archive *record*. Tags, notes and the
 * title are somebody's filing rather than the agreement, and stay editable for
 * as long as the contract exists: an archive whose labels freeze the moment a
 * document is signed keeps its first reader's typos forever. There is no
 * helper for that, because it has no condition to test.
 */
export function canEditRental(status: ContractStatus): boolean {
  return status === "DRAFT";
}

/**
 * The colour each state is drawn in, in the same vocabulary the utlägg statuses
 * use (lib/domain/status.ts). One language across the app: green means done,
 * violet means it is with somebody else, grey means nobody has committed to
 * anything yet.
 *
 * EXPIRED is a warning rather than a danger. A lapsed agreement is a thing to
 * notice, not a thing that has gone wrong, and colouring it red next to a
 * genuinely cancelled contract would flatten the difference between them.
 */
export const CONTRACT_STATUS_TONE: Record<ContractDisplayStatus, Tone> = {
  DRAFT: "neutral",
  OUT_FOR_SIGNATURE: "purple",
  SIGNED: "success",
  EXPIRED: "warning",
  TERMINATED: "neutral",
  CANCELLED: "danger",
};

/** The states a filter offers, in the order it draws them. */
export const CONTRACT_DISPLAY_STATUSES: readonly ContractDisplayStatus[] = [
  "DRAFT",
  "OUT_FOR_SIGNATURE",
  "SIGNED",
  "EXPIRED",
  "TERMINATED",
  "CANCELLED",
];

/**
 * The list's tabs, as sets of stored statuses.
 *
 * Here rather than beside the query that uses it, because the list screen has
 * to draw the same tabs the query filters on, and it runs in the browser. A
 * value living in lib/data would drag the whole query layer, and Prisma behind
 * it, across the boundary; the boundary test would not catch that, but the
 * bundler does, loudly, at build time.
 *
 * "Avslutade" deliberately does not include a contract that has merely run out
 * of time. Expiry is derived rather than stored, so it cannot be a
 * `status in (...)` clause, and making the tab mean "ended or lapsed" would
 * need a second, date-shaped condition that a reader of this table could not
 * see. A lapsed contract sits under "Signerade" and says EXPIRED on its own
 * row, which is both true and where somebody looking for last year's agreement
 * would go for it.
 */
export const CONTRACT_STATUS_TAB: Record<string, ContractStatus[] | undefined> = {
  "": undefined,
  draft: ["DRAFT", "OUT_FOR_SIGNATURE"],
  signed: ["SIGNED"],
  ended: ["TERMINATED", "CANCELLED"],
};

/**
 * The tab values the list offers, in the order it draws them.
 *
 * Derived from the record above rather than written out again, so the tabs a
 * screen draws and the filters a query honours cannot come to disagree. Object
 * key order is insertion order for string keys, which is what makes this the
 * reading order too.
 */
export const CONTRACT_TABS: readonly string[] = Object.keys(CONTRACT_STATUS_TAB);
