// Who else has an utlägg's booking screen open. The timings, and the rule for
// when somebody stops counting as being there.
//
// Presence is advisory. It puts a name on a screen and nothing else: no write
// anywhere reads it, and no control is disabled by it. What stops two
// bookkeepers overwriting each other is the utlägg's own updatedAt, checked in
// the write (see app/api/expenses/[id]/book/route.ts). So a presence that
// lingers after its user has gone costs a stale name for a few seconds, and can
// never hold an utlägg hostage.
//
// Plain constants, because both sides need them: the server to decide who is
// present, the client to know how often to say so.

import type { ExpenseStatus } from "./types";
import type { ExportLockView } from "./export-claim";

/** How often an open booking screen says it is still there. */
export const HEARTBEAT_MS = 10_000;

/**
 * How long a heartbeat counts for. Three missed heartbeats, so one slow request
 * does not make a bookkeeper flicker out, and a tab that crashed, a lid that was
 * shut or a network that dropped clears itself in half a minute.
 *
 * Short is safe because a hidden tab is idle (below), and an idle tab removes
 * itself on purpose. Background-tab timer throttling never has to be ridden out.
 */
export const PRESENCE_TTL_MS = 30_000;

/** No interaction for this long and you are no longer "on" the utlägg. */
export const IDLE_MS = 5 * 60_000;

/**
 * A hidden tab is idle after this long. Not at once: switching to the mail to
 * check an amount and back should not make the banner on a colleague's screen
 * blink.
 */
export const HIDDEN_GRACE_MS = 60_000;

/** How often the Bokföring list asks who is booking what. */
export const LIST_POLL_MS = 15_000;

/** Somebody who has an utlägg's booking screen open. */
export interface PresentUser {
  id: string;
  name: string;
}

/** What the Bokföring list polls for. See app/api/expenses/presence. */
export interface LiveBookkeeping {
  /** Who else has each utlägg's booking screen open, by expense id. */
  booking: Record<string, PresentUser[]>;
  /** Which utlägg an export holds locked, by expense id. */
  exporting: Record<string, ExportLockView>;
}

/** What the booking screen's heartbeat is answered with. */
export interface PresenceAnswer {
  others: PresentUser[];
  /** The utlägg's version now. Differs from the screen's once somebody saved. */
  updatedAt: string;
  status: ExpenseStatus;
  /** Who acted on it last, to say who changed it. Absent when nobody is known. */
  updatedBy?: PresentUser;
}

/**
 * Whether a booking screen should still announce its user.
 *
 * `hiddenSince` is when the tab was last hidden, or null while it is visible.
 */
export function isIdle(
  now: number,
  lastActivityAt: number,
  hiddenSince: number | null,
): boolean {
  if (hiddenSince !== null && now - hiddenSince >= HIDDEN_GRACE_MS) return true;
  return now - lastActivityAt >= IDLE_MS;
}
