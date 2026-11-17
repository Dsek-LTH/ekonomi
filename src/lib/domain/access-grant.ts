// Personal grants (AccessGrant): the period one runs for, from the days the form names. Pure.
//
// The form asks for days, not times. A grant from a day starts at that day's Stockholm midnight (or now, for
// today or no day at all), and a grant until a day ends at the midnight after it, so the last day named is
// included in full.

const ZONE = "Europe/Stockholm";

const wallClock = new Intl.DateTimeFormat("en-US", {
  timeZone: ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** What a Stockholm clock shows at `at`, read back as if it were UTC. The difference to `at` is the offset. */
function stockholmAsUtc(at: number): number {
  const p = Object.fromEntries(wallClock.formatToParts(new Date(at)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
}

/** The instant a Stockholm day (YYYY-MM-DD) begins. Sweden changes clocks at 02:00 and 03:00, never at midnight. */
export function stockholmMidnight(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  const utc = Date.UTC(y, m - 1, d);
  return new Date(utc - (stockholmAsUtc(utc) - utc));
}

/** The Stockholm day after `day`. */
function nextDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/** The Stockholm day `at` falls on. */
export function stockholmDayOf(at: Date): string {
  return new Date(stockholmAsUtc(at.getTime())).toISOString().slice(0, 10);
}

export type GrantPeriod =
  | { ok: true; validFrom: Date; validUntil: Date | null }
  | { ok: false; error: "grant.endsInPast" | "grant.endsBeforeStart" };

/**
 * The period a grant from `from` until `until` (both inclusive Stockholm days, null for "now" and "until
 * removed") runs for. A start of today or earlier is now: a grant is not backdated.
 */
export function grantPeriod(from: string | null, until: string | null, now: Date): GrantPeriod {
  const start = from === null ? now : stockholmMidnight(from);
  const validFrom = start.getTime() < now.getTime() ? now : start;
  if (until === null) return { ok: true, validFrom, validUntil: null };

  const validUntil = stockholmMidnight(nextDay(until));
  if (validUntil.getTime() <= now.getTime()) return { ok: false, error: "grant.endsInPast" };
  if (validUntil.getTime() <= validFrom.getTime()) {
    return { ok: false, error: "grant.endsBeforeStart" };
  }
  return { ok: true, validFrom, validUntil };
}

/** Whether a grant is in force at `now`, waiting to start, or over. */
export function grantState(
  grant: { validFrom: Date; validUntil: Date | null },
  now: Date,
): "active" | "scheduled" | "ended" {
  if (grant.validUntil !== null && grant.validUntil.getTime() <= now.getTime()) return "ended";
  if (grant.validFrom.getTime() > now.getTime()) return "scheduled";
  return "active";
}

/** The last day a grant is in force on, the way the form named it. Null for a grant until removed. */
export function lastDay(validUntil: Date | null): string | null {
  return validUntil === null ? null : stockholmDayOf(new Date(validUntil.getTime() - 1));
}
