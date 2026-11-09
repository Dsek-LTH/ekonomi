// Who else has an utlägg's booking screen or review open. Presence is advisory: nothing reads it to
// block a write. Overwrites are stopped by the utlägg's updatedAt (app/api/expenses/[id]/book/route.ts).
// Plain constants because the server and the client both need them.

import type { ExpenseStatus } from "./types";
import type { ExportLockView } from "./export-claim";

/** How often an open booking screen says it is still there. */
export const HEARTBEAT_MS = 10_000;

/** How long a heartbeat counts for: three missed ones. A hidden tab is idle and removes itself, so background timer throttling never has to be ridden out. */
export const PRESENCE_TTL_MS = 30_000;

/** No interaction for this long and you are no longer "on" the utlägg. */
export const IDLE_MS = 5 * 60_000;

/** A hidden tab is idle after this long, so a quick check of the mail does not blink the banner on a colleague's screen. */
export const HIDDEN_GRACE_MS = 60_000;

/** How often the Bokföring list asks who is booking what. */
export const LIST_POLL_MS = 15_000;

export type PresenceScreen = "book" | "review";

export interface PresentUser {
  id: string;
  name: string;
}

export interface LiveBookkeeping {
  booking: Record<string, PresentUser[]>;
  reviewing: Record<string, PresentUser[]>;
  exporting: Record<string, ExportLockView>;
}

export interface PresenceAnswer {
  others: PresentUser[];
  updatedAt: string;
  status: ExpenseStatus;
  updatedBy?: PresentUser;
}

/** Whether a booking screen should still announce its user. `hiddenSince` is when the tab was hidden, or null while visible. */
export function isIdle(now: number, lastActivityAt: number, hiddenSince: number | null): boolean {
  if (hiddenSince !== null && now - hiddenSince >= HIDDEN_GRACE_MS) return true;
  return now - lastActivityAt >= IDLE_MS;
}
