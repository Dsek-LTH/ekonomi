// The utlägg's human reference: "DEK26-0043", the number it is known by
// everywhere from the receipt envelope to the ledger, and the parenthesised tail
// of the voucher text sent to Fortnox (see api/expenses/[id]/export). Not the
// Fortnox verifikationsnummer, which Fortnox assigns on export and which lives
// on Verification.fortnoxSeries/fortnoxNumber.
//
// Three properties the format has to keep, because code elsewhere leans on all
// of them:
//
//  - The prefix is FIXED WIDTH ("DEK26-", six characters). The next number is
//    taken by reading the highest reference that starts with it and slicing the
//    prefix off, which only works while every reference in a year is the same
//    shape.
//  - The counter is ZERO-PADDED to a fixed width, so lexicographic order is
//    numeric order. Lists sort on this string.
//  - The year runs two digits at the front, so references also sort correctly
//    ACROSS years ("25-9999" < "26-0001"). That holds until 2100, at which
//    point a section that still runs this code has a nicer problem to solve.
//
// A levfaktura is numbered the same way in a series of its own, "LEV26-0012",
// so the two are told apart by their number alone. Both prefixes are three
// letters, which is what keeps the first property above true for either.
//
// Nothing but the counter follows the separator, so the hyphen is unambiguous
// here, unlike in the "D-26|0043" this replaced, where the prefix had a hyphen
// of its own and the separator had to be a pipe to stay distinguishable.

const COUNTER_DIGITS = 4;

/** Which series: utlägg, or leverantörsfakturor. */
export type ReferenceSeries = "DEK" | "LEV";

/** "DEK26-": everything before the counter, for a given calendar year. */
export function referencePrefix(year: number, series: ReferenceSeries = "DEK"): string {
  return `${series}${String(year % 100).padStart(2, "0")}-`;
}

/** "DEK26-0043" from its two parts. */
export function formatReference(year: number, counter: number, series: ReferenceSeries = "DEK"): string {
  return `${referencePrefix(year, series)}${String(counter).padStart(COUNTER_DIGITS, "0")}`;
}

/**
 * The reference after `last`, where `last` is the highest one already taken in
 * `year`, null when this is the year's first, which is the only case the
 * caller has to think about. Every reference in the database is in this format
 * (the migration rewrote the ones that weren't), so the counter is simply the
 * prefix sliced off.
 */
export function nextReference(year: number, last: string | null, series: ReferenceSeries = "DEK"): string {
  const counter = Number.parseInt(last?.slice(referencePrefix(year, series).length) ?? "", 10);
  return formatReference(year, Number.isFinite(counter) ? counter + 1 : 1, series);
}

/**
 * What to call an utlägg in a log line or an error message: its reference once
 * it has one, and its id before that. Never nothing: a message that names the
 * row it is about is the whole reason anyone reads it.
 */
export function expenseLabel(e: { id: string; reference?: string | null }): string {
  return e.reference ?? e.id;
}
