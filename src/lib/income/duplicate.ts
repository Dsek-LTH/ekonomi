// The fail-safe against booking the same day's takings into Fortnox twice.
//
// The app already refuses to book the same source, committee and day twice:
// a partial unique index over booked reports, checked again at import so it
// reads as a sentence rather than as a constraint violation (lib/income/
// batch.ts). That guard only knows what *this* database has done. It says
// nothing about a day that was exported from an older install, from the intakt
// CLI this replaced, or from a database that has since been reset, and those
// vouchers are in Fortnox all the same.
//
// So Fortnox itself is asked. A day's takings are identifiable over there by
// two things and no more: the transaction date, and the description the
// voucher carries (see incomeVoucherDescription). Same series, same date, same
// text means the takings are already booked, whoever booked them.
//
// Read with the SERVICE token rather than the bookkeeper's personal one. A
// check that only ran for people who happen to have logged into Fortnox in the
// last few hours would be worth very little as a fail-safe, and reading needs
// no attribution, unlike writing a voucher, which is why exports still use the
// personal token.
import "server-only";

import {
  financialYearsFor,
  getConnection,
  getServiceToken,
  listFinancialYears,
  listVouchers,
} from "@/lib/fortnox";

import { loadBookkeepingSettings } from "@/lib/server/bookkeeping-settings";
import { incomeVoucherKey, incomeVoucherSeries } from "./voucher";

export { incomeVoucherKey };

/**
 * Why the check did not run. Both are ordinary states, running without
 * Fortnox is supported, but they are different ordinary states: not being
 * connected is a decision, a failed call is an outage, and only the second is
 * worth putting in front of anyone.
 */
type IncomeCheckSkip = "notConnected" | "seriesUnset" | "failed";

export interface FortnoxIncomeVouchers {
  /** False means nothing was compared. Treat every day as unknown, not free. */
  checked: boolean;
  skipped: IncomeCheckSkip | null;
  /** `incomeVoucherKey` → the voucher's label, e.g. "IR-142". */
  byKey: Map<string, string>;
  /** The series that was searched, for the message that names it. */
  series: string | null;
}

const empty = (skipped: IncomeCheckSkip, series: string | null): FortnoxIncomeVouchers => ({
  checked: false,
  skipped,
  byKey: new Map(),
  series,
});

/**
 * What Fortnox already has in the income series between two dates, inclusive.
 *
 * Never throws. Every caller of this is doing something else, importing a
 * range or exporting a day, and a check that cannot run must not take that
 * down with it; `checked: false` is the honest answer, and the callers say so
 * rather than implying the day is clear.
 */
export async function fortnoxIncomeVouchers(
  from: string,
  to: string,
): Promise<FortnoxIncomeVouchers> {
  const conn = await getConnection();
  if (!conn) return empty("notConnected", null);
  // The series income is filed under, which is a setting of its own. See
  // incomeVoucherSeries. Read here rather than assumed, because looking in the
  // wrong series answers "nothing booked" for a day that is.
  const settings = await loadBookkeepingSettings();
  const series = incomeVoucherSeries(settings, conn.voucherSeries);
  // No series chosen, so there is nowhere to look. Said, not taken as "clear".
  if (!series) return empty("seriesUnset", null);

  try {
    const token = await getServiceToken();

    // Fortnox answers from one financial year at a time, so a range that
    // straddles a year-end is asked for once per year it touches. A range that
    // lands in no year at all, a date before the books begin, is asked for
    // without one, which lets Fortnox answer from the current year rather than
    // returning nothing at all.
    const years = financialYearsFor(await listFinancialYears(token), from, to);
    const queries = years.length > 0 ? years.map((y) => ({ from, to, financialYearId: y.id })) : [{ from, to }];

    const byKey = new Map<string, string>();
    for (const query of queries) {
      for (const v of await listVouchers(token, query)) {
        // Other series are other work, utlägg go to their own, and a
        // description that matches one of ours there is a coincidence.
        if (v.series !== series) continue;
        byKey.set(incomeVoucherKey(v.date, v.description), `${v.series}-${v.number}`);
      }
    }

    return { checked: true, skipped: null, byKey, series };
  } catch (e) {
    console.error(`[fortnox] could not read vouchers ${from}..${to} for the duplicate check`, e);
    return empty("failed", series);
  }
}
