// The utlägg's human reference, "DEK26-0043" (also the tail of the Fortnox voucher text, see
// api/expenses/[id]/export). Not the Fortnox verifikationsnummer. Code leans on three properties:
//  - the prefix is fixed width ("DEK26-"): the next number slices it off the highest reference;
//  - the counter is zero-padded, so string order is numeric order;
//  - the year is two digits at the front, so references sort across years.
// A levfaktura uses the same format in its own series, "LEV26-0012" (both prefixes are 3 letters).

const COUNTER_DIGITS = 4;

export type ReferenceSeries = "DEK" | "LEV";

export function referencePrefix(year: number, series: ReferenceSeries = "DEK"): string {
  return `${series}${String(year % 100).padStart(2, "0")}-`;
}

export function formatReference(
  year: number,
  counter: number,
  series: ReferenceSeries = "DEK",
): string {
  return `${referencePrefix(year, series)}${String(counter).padStart(COUNTER_DIGITS, "0")}`;
}

/** The reference after `last`, the highest taken in `year`; null when this is the year's first. */
export function nextReference(
  year: number,
  last: string | null,
  series: ReferenceSeries = "DEK",
): string {
  const counter = Number.parseInt(last?.slice(referencePrefix(year, series).length) ?? "", 10);
  return formatReference(year, Number.isFinite(counter) ? counter + 1 : 1, series);
}

/** What to call an utlägg in a log line or error: its reference once it has one, its id before. */
export function expenseLabel(e: { id: string; reference?: string | null }): string {
  return e.reference ?? e.id;
}
