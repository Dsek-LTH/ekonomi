// A date the app is willing to store: complete to the day, and a day that exists. Date fields are
// masked text, so "2026" or "2026-07" can be left in the form and `new Date` would read them as 1 Jan / 1 Jul.
export function isCompleteDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  // The regex proves the shape; round-tripping proves the day is real ("2026-02-30" must not roll into March).
  const d = new Date(`${value}T00:00:00Z`);
  return !isNaN(d.getTime()) && isoDay(d) === value;
}

/** The UTC calendar day of an instant, as `YYYY-MM-DD`, for a `@db.Date` column (midnight UTC). */
export const isoDay = (d: Date): string => d.toISOString().slice(0, 10);

/** An ISO day as the instant that names it, or null. Midnight UTC, never the server's timezone: a local-midnight Date lands on the day before in Swedish summer time. Same construction as lib/data/list-query.ts. */
export function isoToDate(day: string | null | undefined): Date | null {
  return day ? new Date(`${day}T00:00:00.000Z`) : null;
}

// Today as the section counts days: Stockholm, not the host's UTC (which says yesterday until 02:00
// summer time and would refuse a late-night purchase as future). sv-SE prints YYYY-MM-DD.
export const stockholmDay = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Stockholm",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function today(): string {
  return stockholmDay.format(new Date());
}

// A purchase that hasn't happened yet: a date past today is a typo. YYYY-MM-DD strings sort as they
// date. An incomplete date is not "in the future", `isCompleteDate` names that error.
export function isFutureDate(value: string, now: string = today()): boolean {
  return isCompleteDate(value) && value > now;
}

// Whole days between a date and today: 0 today, negative for a future day. Both read at UTC midnight,
// so a clock-change weekend cannot turn day 61 into day 60.
export function daysAgo(value: string, now: string = today()): number {
  const then = Date.parse(`${value}T00:00:00Z`);
  const day = Date.parse(`${now}T00:00:00Z`);
  return Math.round((day - then) / 86_400_000);
}

// A date so many whole months later, clamped to a day that exists (31 May + 9 months is not 31
// February; JavaScript's Date would roll into March). Read at UTC midnight.
export function addMonths(value: string, months: number): string {
  const [y, m, d] = value.split("-").map(Number);
  // Month 0 is January here.
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  // Day 0 of the following month is the last day of this one.
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return isoDay(target);
}

// The ISO week a day falls in, as "2026-W41": Monday to Sunday, the year is the one its Thursday is
// in (2027-01-01 is still 2026-W53). What the weekly digest counts in.
export function isoWeek(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  // Thursday decides the year a week belongs to.
  const thursday = new Date(d);
  thursday.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7));
  const yearStart = Date.UTC(thursday.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((thursday.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${thursday.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}
