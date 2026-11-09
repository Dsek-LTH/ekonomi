// Fail-safe against booking the same day's takings into Fortnox twice, e.g. from an older install
// or a reset database. Same series, date and method (see incomeVoucherCoversDay) means it is
// booked. Read with the SERVICE token so the check does not depend on who logged in recently.

import "server-only";

import {
  financialYearsFor,
  getConnection,
  getServiceToken,
  listFinancialYears,
  listVouchers,
} from "@/lib/fortnox";

import { loadBookkeepingSettings } from "@/lib/server/bookkeeping-settings";
import { incomeVoucherCoversDay, incomeVoucherKey, incomeVoucherSeries } from "./voucher";
import type { IncomeSource } from "@/lib/domain/types";

/** Why the check did not run: not connected is a decision, a failed call is an outage. */
type IncomeCheckSkip = "notConnected" | "seriesUnset" | "failed";

export interface FortnoxIncomeVouchers {
  /** False means nothing was compared. Treat every day as unknown, not free. */
  checked: boolean;
  skipped: IncomeCheckSkip | null;
  /** The voucher already booking some of this source's money on this day, e.g. "IR-142", or null. */
  forDay: (date: string, source: IncomeSource) => string | null;
  /** The voucher with exactly this date and description (`incomeVoucherKey`), or null. For reports booked before the per-day voucher. */
  exact: (date: string, description: string) => string | null;
  /** The series that was searched, for the message that names it. */
  series: string | null;
}

const empty = (skipped: IncomeCheckSkip, series: string | null): FortnoxIncomeVouchers => ({
  checked: false,
  skipped,
  forDay: () => null,
  exact: () => null,
  series,
});

/** What Fortnox already has in the income series between two dates. Never throws: `checked: false` means it could not run. */
export async function fortnoxIncomeVouchers(
  from: string,
  to: string,
): Promise<FortnoxIncomeVouchers> {
  const conn = await getConnection();
  if (!conn) return empty("notConnected", null);
  // Read the income series here: the wrong series would answer "nothing booked".
  const settings = await loadBookkeepingSettings();
  const series = incomeVoucherSeries(settings, conn.voucherSeries);
  // No series chosen, so there is nowhere to look. Said, not taken as "clear".
  if (!series) return empty("seriesUnset", null);

  try {
    const token = await getServiceToken();

    // Fortnox answers per financial year, so ask once per year touched, and without a year when
    // the range falls in none.
    const years = financialYearsFor(await listFinancialYears(token), from, to);
    const queries =
      years.length > 0 ? years.map((y) => ({ from, to, financialYearId: y.id })) : [{ from, to }];

    const byDate = new Map<string, { label: string; description: string }[]>();
    for (const query of queries) {
      for (const v of await listVouchers(token, query)) {
        // Other series (utlägg) are not ours.
        if (v.series !== series) continue;
        const list = byDate.get(v.date) ?? [];
        list.push({ label: `${v.series}-${v.number}`, description: v.description });
        byDate.set(v.date, list);
      }
    }

    const forDay = (date: string, source: IncomeSource) =>
      byDate.get(date)?.find((v) => incomeVoucherCoversDay(source, v.description))?.label ?? null;
    const exact = (date: string, description: string) =>
      byDate
        .get(date)
        ?.find((v) => incomeVoucherKey(date, v.description) === incomeVoucherKey(date, description))
        ?.label ?? null;
    return { checked: true, skipped: null, forDay, exact, series };
  } catch (e) {
    console.error(`[fortnox] could not read vouchers ${from}..${to} for the duplicate check`, e);
    return empty("failed", series);
  }
}
