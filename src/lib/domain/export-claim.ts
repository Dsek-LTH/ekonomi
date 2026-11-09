// The export lock: an utlägg's export state read off the three columns that record it (lib/server/export-claim.ts
// writes them). An utlägg is never exported twice: Fortnox has no voucher delete, so a lock is only
// released on certainty and doubt wins.

import type { ExportClaimState } from "./types";

/** A lock taken and never sent anywhere after this long is an export that died before asking Fortnox, so the next Exportera may take it over. Taking over changes its identity, so a merely slow export finds it gone and stops. */
export const CLAIM_ABANDONED_MS = 5 * 60_000;

/** How long a Fortnox write may take before it is called off. A call-off leaves the lock uncertain, since it did not say whether the voucher was made. */
export const FORTNOX_WRITE_TIMEOUT_MS = 60_000;

/** A voucher request this old with no answer cannot still be in flight (far past FORTNOX_WRITE_TIMEOUT_MS). Until then SENT is an export in progress. */
export const SEND_ABANDONED_MS = 10 * 60_000;

/** What the lock means now: free (Exportera may be pressed), exporting (wait), uncertain (an export ended without saying whether Fortnox made the voucher, so somebody must look). */
export type ExportLock = "free" | "exporting" | "uncertain";

export function exportLock(
  state: ExportClaimState | null,
  claimedAt: Date | string | null,
  now: number,
): ExportLock {
  if (!state) return "free";
  if (state === "UNCERTAIN") return "uncertain";
  const age = claimedAt ? now - new Date(claimedAt).getTime() : 0;
  if (state === "SENT") return age >= SEND_ABANDONED_MS ? "uncertain" : "exporting";
  return age >= CLAIM_ABANDONED_MS ? "free" : "exporting";
}

export interface ExportLockView {
  lock: Exclude<ExportLock, "free">;
  by: { id: string; name: string } | null;
}
