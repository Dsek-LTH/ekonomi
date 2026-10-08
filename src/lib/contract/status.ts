// Where a contract stands, as a reader sees it.
//
// Nothing here is stored. An agreement is Signerat when its signed copy is in
// the archive and Utkast until then, so the status cannot disagree with the
// files it describes. A screen adds one more, EXPIRED, for a signed contract
// whose period has run out.
//
// An expiry is a fact about today, not a decision anybody took. Stored, it
// would need a job to run every night, and the morning that job did not run
// every screen in the app would quietly say a lapsed contract is still in
// force. Derived, the same row answers correctly on any day it is read.
import type { Tone } from "@/lib/domain/status";
import { isImmutable, isSigned } from "@/lib/contract/file-roles";
import type { ContractFileRole, ContractKind, ContractStatus } from "@/lib/domain/types";

/** The derived states plus expiry. What a status pill renders. */
type ContractDisplayStatus = ContractStatus | "EXPIRED";

/**
 * Where an agreement stands: SIGNED once its signed copy has been uploaded,
 * DRAFT until then. Null for PROTOCOL and OTHER, which carry no status at all:
 * a lean document is filed or it doesn't exist.
 */
export function contractStatus(contract: {
  kind: ContractKind;
  files: readonly { role: ContractFileRole }[];
}): ContractStatus | null {
  if (contract.kind !== "CONTRACT") return null;
  return contract.files.some((f) => isSigned(f.role)) ? "SIGNED" : "DRAFT";
}

/**
 * Whether a contract has run out, as of `today`.
 *
 * Only a SIGNED contract can expire. A draft with a date in the past is a draft
 * somebody abandoned, and calling it expired would put it in the list of things
 * that need renewing, which is exactly where it does not belong.
 *
 * Dates are ISO days ("2026-09-06"), compared as strings. That works because
 * ISO days sort lexically, and it avoids a timezone: `validTo` is a DATE
 * column, so the day it names is the same day everywhere, and turning it into
 * an instant to compare is how a contract expires an evening early in Sweden.
 */
export function isExpired(
  contract: { status: ContractStatus | null; validTo: string | null },
  today: string,
): boolean {
  if (contract.status !== "SIGNED") return false;
  if (contract.validTo === null) return false;
  return contract.validTo < today;
}

/**
 * The status to show, expiry included. Null for PROTOCOL/OTHER, which a screen
 * renders the same way it renders any other absent fact, a dash rather than a
 * pill.
 */
export function displayStatus(
  contract: { status: ContractStatus | null; validTo: string | null },
  today: string,
): ContractDisplayStatus | null {
  if (contract.status === null) return null;
  return isExpired(contract, today) ? "EXPIRED" : contract.status;
}

/**
 * Whether the rental terms may still be changed: the renter, the gear, the
 * dates, the price and how many sign.
 *
 * Until the signed copy is uploaded. Before that the contract is a proposal,
 * and an edit redraws the document. After it, changing what the renter put
 * their name to is the one edit that must not be possible, and removing the
 * signed file is what reopens it.
 *
 * Deliberately narrower than editing the archive *record*. Tags, notes and the
 * title are somebody's filing rather than the agreement, and stay editable for
 * as long as the contract exists: an archive whose labels freeze the moment a
 * document is signed keeps its first reader's typos forever.
 */
export function canEditRental(contract: {
  files: readonly { role: ContractFileRole }[];
}): boolean {
  return !contract.files.some((f) => isSigned(f.role) || isImmutable(f.role));
}

/**
 * The colour each state is drawn in, in the same vocabulary the utlägg statuses
 * use (lib/domain/status.ts): green means done, grey means nobody has committed
 * to anything yet. EXPIRED is a warning rather than a danger, because a lapsed
 * agreement is a thing to notice rather than a thing that has gone wrong.
 */
export const CONTRACT_STATUS_TONE: Record<ContractDisplayStatus, Tone> = {
  DRAFT: "neutral",
  SIGNED: "success",
  EXPIRED: "warning",
};

/**
 * The list's tabs, in the order it draws them. What each one matches is a
 * question about the files, so it is asked in lib/data/contracts.ts.
 *
 * Here rather than there because the list screen has to draw the same tabs, and
 * it runs in the browser. A value living in lib/data would drag Prisma across
 * that boundary.
 *
 * A contract that has merely run out of time sits under "Signerade" and says
 * EXPIRED on its own row, which is both true and where somebody looking for
 * last year's agreement would go for it.
 */
export const CONTRACT_TABS: readonly string[] = ["", "draft", "signed"];
