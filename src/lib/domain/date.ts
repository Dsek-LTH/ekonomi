// A date the app is willing to store: complete to the day, and a day that
// exists.
//
// The date fields are masked text, not a native picker, so a half-typed date is
// a real state the form can be left in. "2026" or "2026-07" both sit there
// looking plausible. `new Date` reads them without complaint, as 1 January and
// 1 July, so accepting one stores a date nobody typed. Everything that takes a
// typed date checks it here first.
export function isCompleteDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  // The regex only proves the shape; round-tripping proves the day is real, so
  // "2026-02-30" doesn't roll over into March.
  const d = new Date(`${value}T00:00:00Z`);
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

// Today, as the section counts days. Deliberately not the server's own day: the
// app runs on a host set to UTC, and between midnight and 02:00 Swedish summer
// time that host still says yesterday, long enough for a late-night purchase to
// be refused as being in the future. Everyone typing a date here is reading it
// off a Swedish receipt, so Stockholm is the calendar that decides.
// sv-SE prints exactly the YYYY-MM-DD the date fields already carry.
const stockholmDay = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Stockholm",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function today(): string {
  return stockholmDay.format(new Date());
}

// A purchase that hasn't happened yet. Nothing can be bought tomorrow, so a
// date past today is a typo (a wrong year, most often) rather than a claim,
// caught here before it reaches an attester or the books.
//
// Both sides are the same YYYY-MM-DD string, which sorts the way it dates, so
// the comparison is the whole check. An incomplete date is not "in the future":
// it's the other error, and `isCompleteDate` is what names it.
export function isFutureDate(value: string, now: string = today()): boolean {
  return isCompleteDate(value) && value > now;
}

// Whole days between a date and today: 0 for today, 1 for yesterday, negative
// for a day still to come. Both ends are calendar days read at UTC midnight, so
// the subtraction is exact. A clock-change weekend can't shave an hour off it
// and turn day 61 back into day 60.
export function daysAgo(value: string, now: string = today()): number {
  const then = Date.parse(`${value}T00:00:00Z`);
  const day = Date.parse(`${now}T00:00:00Z`);
  return Math.round((day - then) / 86_400_000);
}
