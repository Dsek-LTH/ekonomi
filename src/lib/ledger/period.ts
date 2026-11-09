// Which financial year, and which months of it, a request is asking about. Shared by /api/ledger/report and
// /api/ledger/trend so the table and the charts describe the same span.
import "server-only";

import { getLedgerYears, type LedgerYear } from ".";
import { parseCostCenters } from "./cost-center-filter";
import { isoDay } from "@/lib/domain/date";

// The period's ends as the query writes them: a day ("YYYY-MM-DD"), or a month ("YYYY-MM", from old links)
// meaning its first day at the start and its last at the end. Anything else falls back.
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH = /^(\d{4})-(\d{2})$/;

/** The first day a period covers. Falls back to `fallback`. */
export function periodStart(raw: string | null, fallback: Date): Date {
  const d = DAY.exec(raw ?? "");
  if (d) return new Date(Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3])));
  const m = MONTH.exec(raw ?? "");
  if (m) return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1));
  return fallback;
}

/** The last day a period covers. Falls back to `fallback`. */
export function periodEnd(raw: string | null, fallback: Date): Date {
  const d = DAY.exec(raw ?? "");
  if (d) return new Date(Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3])));
  // Day 0 of the next month is the last of this one.
  const m = MONTH.exec(raw ?? "");
  if (m) return new Date(Date.UTC(Number(m[1]), Number(m[2]), 0));
  return fallback;
}

const clamp = (d: Date, lo: Date, hi: Date) => (d < lo ? lo : d > hi ? hi : d);

interface LedgerPeriod {
  /** Every synced year, newest first. Both routes send this on for the picker. */
  years: LedgerYear[];
  /** The one being reported on: the year asked for, else the newest. */
  selected: LedgerYear;
  /** The financial year's own span, which the period below is clamped into. */
  yearStart: Date;
  yearEnd: Date;
  from: Date;
  to: Date;
  /** Which cost centres: undefined for every one, else the codes asked for, "" for rows carrying none. */
  costCenterCodes: string[] | undefined;
}

/** The period a ledger request is about, or null when nothing has been synced yet. */
export async function resolveLedgerPeriod(url: URL): Promise<LedgerPeriod | null> {
  const years = await getLedgerYears();
  const yearParam = Number(url.searchParams.get("year"));
  const selected = years.find((y) => y.id === yearParam) ?? years[0];
  if (!selected) return null;

  const yearStart = new Date(`${selected.fromDate}T00:00:00Z`);
  const yearEnd = new Date(`${selected.toDate}T00:00:00Z`);
  const from = clamp(periodStart(url.searchParams.get("from"), yearStart), yearStart, yearEnd);
  // Lower-bounded by `from`: a period that ended before it began is clamped up.
  const to = clamp(periodEnd(url.searchParams.get("to"), yearEnd), from, yearEnd);

  return {
    years,
    selected,
    yearStart,
    yearEnd,
    from,
    to,
    costCenterCodes: parseCostCenters(url.searchParams),
  };
}

/** The period as the response reports it back: "YYYY-MM-DD" at each end. */
export const periodOf = (p: Pick<LedgerPeriod, "from" | "to">) => ({
  from: isoDay(p.from),
  to: isoDay(p.to),
});
