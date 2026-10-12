// The export lock: what state an utlägg's export to Fortnox is in, read off the
// three columns that record it. See the export lock on Expense in the schema,
// and lib/server/export-claim.ts for the writes.
//
// The rule everything here serves: an utlägg is never exported twice. Fortnox
// has no delete for a voucher, so a lock is only ever let go of on certainty.
// Where there is a doubt, the doubt wins and a person looks in Fortnox.

import type { ExportClaimState } from "./types";

/**
 * A lock taken and then never sent anywhere, after this long, is somebody whose
 * export died before it asked Fortnox for anything (the server restarted while
 * the cover was being drawn, say). Nothing can exist in Fortnox for it, so the
 * next press of Exportera may take it over.
 *
 * Generous against the slowest honest export, which renders a cover and
 * uploads a PDF before it sends. And safe even if that export is merely slow:
 * taking the lock over changes its identity, so the slow one finds it gone
 * when it tries to send, and stops.
 */
export const CLAIM_ABANDONED_MS = 5 * 60_000;

/**
 * How long a write to Fortnox (creating the voucher, attaching the PDF to it)
 * may take before it is called off. Without a limit a request that hangs has no
 * end, and the rule below needs one: it is what makes "this request can no
 * longer be in flight" a fact rather than a hope. A request called off this way
 * did not say whether it made the voucher, so it leaves the lock uncertain.
 */
export const FORTNOX_WRITE_TIMEOUT_MS = 60_000;

/**
 * A voucher request sent this long ago with no answer recorded has no answer
 * coming. Far past FORTNOX_WRITE_TIMEOUT_MS, so a request this old cannot still
 * be in flight. Until then a lock in SENT is an export in progress, and nobody
 * may resolve it by hand.
 */
export const SEND_ABANDONED_MS = 10 * 60_000;

/**
 * What the lock means right now.
 *
 *   free        nobody is exporting it, and Exportera may be pressed
 *   exporting   an export is under way, so wait for it
 *   uncertain   an export ended without saying whether Fortnox made the
 *               voucher, and somebody has to look before anything else happens
 */
export type ExportLock = "free" | "exporting" | "uncertain";

export function exportLock(
  state: ExportClaimState | null,
  claimedAt: Date | string | null,
  now: number,
): ExportLock {
  if (!state) return "free";
  if (state === "UNCERTAIN") return "uncertain";
  // A lock with no time on it cannot be judged stale, so it is not.
  const age = claimedAt ? now - new Date(claimedAt).getTime() : 0;
  if (state === "SENT") return age >= SEND_ABANDONED_MS ? "uncertain" : "exporting";
  return age >= CLAIM_ABANDONED_MS ? "free" : "exporting";
}

/** An export lock as the Bokföring list sees it. */
export interface ExportLockView {
  lock: Exclude<ExportLock, "free">;
  /** Who pressed Exportera. Null if they have since been removed. */
  by: { id: string; name: string } | null;
}
