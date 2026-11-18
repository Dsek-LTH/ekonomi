// The periods a report can be read over, within one räkenskapsår: the whole year, each of its months, or dates of the
// reader's own. One list for every page that reads a period (Utfall & rapporter, lagerstatistik), so the picker says
// the same thing everywhere. The year is the header's (docs/navigation.md).
import { isoDay } from "@/lib/domain/date";

export interface PeriodYear {
  /** YYYY-MM-DD, both inclusive. */
  fromDate: string;
  toDate: string;
}

// Month names come from the locale (Intl). Two lengths: pickers/readouts have room for "September", an x axis does not.
export const monthName = (locale: string, monthIndex: number, long = true) =>
  new Date(Date.UTC(2000, monthIndex, 1)).toLocaleString(locale, {
    month: long ? "long" : "short",
    timeZone: "UTC",
  });

export const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Every month the financial year spans, as the days it covers (a broken year's first and last are clipped). */
export function monthsOf(
  year: PeriodYear,
): { key: string; from: string; to: string; index: number; y: number }[] {
  const out: { key: string; from: string; to: string; index: number; y: number }[] = [];
  const start = new Date(`${year.fromDate}T00:00:00Z`);
  const end = new Date(`${year.toDate}T00:00:00Z`);
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  while (cursor <= end) {
    const y = cursor.getUTCFullYear();
    const m = cursor.getUTCMonth();
    const first = isoDay(cursor);
    const last = isoDay(new Date(Date.UTC(y, m + 1, 0)));
    out.push({
      key: `${y}-${String(m + 1).padStart(2, "0")}`,
      from: first < year.fromDate ? year.fromDate : first,
      to: last > year.toDate ? year.toDate : last,
      index: m,
      y,
    });
    cursor.setUTCMonth(m + 1);
  }
  return out;
}

export const WHOLE_YEAR = "YEAR";
export const CUSTOM = "CUSTOM";

/**
 * The picker's options for `year`, which one the dates `from`-`to` are, and the dates each option stands for.
 * `custom` is the reader having typed a date by hand: the picker then says so, whatever the dates happen to match.
 */
export function periodOptions(
  year: PeriodYear,
  { from, to, custom }: { from: string; to: string; custom: boolean },
  labels: { wholeYear: string; custom: string; locale: string },
): {
  options: { value: string; label: string }[];
  value: string;
  /** The dates an option stands for. Null for CUSTOM, which keeps whatever is typed. */
  rangeOf: (value: string) => { from: string; to: string } | null;
} {
  const months = monthsOf(year);
  return {
    options: [
      { value: WHOLE_YEAR, label: labels.wholeYear },
      ...months.map((m) => ({
        value: m.key,
        label: `${capitalize(monthName(labels.locale, m.index))} ${m.y}`,
      })),
      { value: CUSTOM, label: labels.custom },
    ],
    value: custom
      ? CUSTOM
      : from === year.fromDate && to === year.toDate
        ? WHOLE_YEAR
        : (months.find((m) => m.from === from && m.to === to)?.key ?? CUSTOM),
    rangeOf: (value) => {
      if (value === CUSTOM) return null;
      const month = months.find((m) => m.key === value);
      return month ? { from: month.from, to: month.to } : { from: year.fromDate, to: year.toDate };
    },
  };
}
