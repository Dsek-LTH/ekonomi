// Which financial year, and which months of it, a request is asking about.
//
// /api/ledger/report and /api/ledger/trend answer about the same period on
// purpose: the table and the charts are two views of one question, and a reader
// switching between them must not find the figures describing different spans.
// They enforced that by holding identical copies of this: the same `monthStart`,
// the same `monthEnd`, the same `clamp`, the same year lookup, the same
// empty-versus-absent rule for `costCenter`. Thirty-five lines, twice, kept in
// step by nothing.
import "server-only";

import { getLedgerYears, type LedgerYear } from ".";

// "YYYY-MM" → the month's first day (UTC). Falls back to `fallback`.
function monthStart(raw: string | null, fallback: Date): Date {
  const m = /^(\d{4})-(\d{2})$/.exec(raw ?? "");
  if (!m) return fallback;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1));
}

// "YYYY-MM" → the month's last day (UTC). Day 0 of the next month is the last
// of this one, which is also what makes a December range end on the 31st
// without the wrap being written out.
function monthEnd(raw: string | null, fallback: Date): Date {
  const m = /^(\d{4})-(\d{2})$/.exec(raw ?? "");
  if (!m) return fallback;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]), 0));
}

const clamp = (d: Date, lo: Date, hi: Date) => (d < lo ? lo : d > hi ? hi : d);

export interface LedgerPeriod {
  /** Every synced year, newest first. Both routes send this on for the picker. */
  years: LedgerYear[];
  /** The one being reported on: the year asked for, else the newest. */
  selected: LedgerYear;
  /** The financial year's own span, which the period below is clamped into. */
  yearStart: Date;
  yearEnd: Date;
  from: Date;
  to: Date;
  /**
   * Which cost centre, as the query means it:
   *
   *   absent          every cost centre
   *   `costCenter=`   the rows carrying none
   *
   * An empty string is therefore a filter and not a missing one, which is why
   * this is `undefined` rather than `""` for the "all" case.
   */
  costCenterCode: string | undefined;
}

/**
 * The period a ledger request is about, or null when nothing has been synced
 * yet and there is no year to report on. Both routes answer that case with an
 * empty payload of their own shape, so it is theirs to word.
 */
export async function resolveLedgerPeriod(url: URL): Promise<LedgerPeriod | null> {
  const years = await getLedgerYears();
  const yearParam = Number(url.searchParams.get("year"));
  const selected = years.find((y) => y.id === yearParam) ?? years[0];
  if (!selected) return null;

  const yearStart = new Date(`${selected.fromDate}T00:00:00Z`);
  const yearEnd = new Date(`${selected.toDate}T00:00:00Z`);
  const from = clamp(monthStart(url.searchParams.get("from"), yearStart), yearStart, yearEnd);
  // Lower-bounded by `from` rather than by the year: a period that ended before
  // it began is not a period, and clamping it up is the only reading of it.
  const to = clamp(monthEnd(url.searchParams.get("to"), yearEnd), from, yearEnd);

  const cc = url.searchParams.get("costCenter");

  return {
    years,
    selected,
    yearStart,
    yearEnd,
    from,
    to,
    costCenterCode: cc === null ? undefined : cc,
  };
}

/** The period as the response reports it back: "YYYY-MM" at each end. */
export const periodOf = (p: Pick<LedgerPeriod, "from" | "to">) => ({
  from: p.from.toISOString().slice(0, 7),
  to: p.to.toISOString().slice(0, 7),
});
