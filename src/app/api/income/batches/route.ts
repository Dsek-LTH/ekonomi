// Fetch a date range from Zettle, sales and fees together, and store it as one
// draft report per day.
//
// Swish is not here: it arrives as an uploaded CSV rather than a JSON body, so
// it has its own route (./swish). Everything after the fetch is shared, see
// lib/income/batch.ts.
import { NextResponse } from "next/server";

import { fail, gate } from "@/lib/api/guard";
import { denyOutsideFiscalYear } from "@/lib/api/fiscal-year";
import { parseBody } from "@/lib/api/parse";
import { FetchIncome } from "@/lib/api/schemas/income";
import { canBookkeep } from "@/lib/domain/permissions";
import { createDayBatch } from "@/lib/income/batch";
import {
  fetchZettleFees,
  fetchZettleSales,
  ZettleError,
  ZettleNotConfiguredError,
} from "@/lib/income/zettle-client";
import { loadFeeRoute, loadRoutingTable } from "@/lib/income/config";
import { fortnoxIncomeVouchers } from "@/lib/income/duplicate";
import { routeZettleSales } from "@/lib/income/routing";

export async function POST(req: Request) {
  const g = await gate(canBookkeep, "auth.denied");
  if (!g.ok) return g.res;

  const parsed = await parseBody(req, FetchIncome);
  if (!parsed.ok) return parsed.res;
  const { from, to } = parsed.data;
  const source = "ZETTLE";

  if (to < from) return fail(422, "income.rangeBackwards");
  // Every day fetched becomes a report, so the whole range is in the year
  // picked in the header. Both ends in it is all of it in it.
  const offYear = (await denyOutsideFiscalYear(from)) ?? (await denyOutsideFiscalYear(to));
  if (offYear) return offYear;

  // Checked before the service is asked, so a setup problem is said as one
  // rather than after a term of purchases has come back with nowhere to go.
  const routing = await loadRoutingTable();
  if (!routing.ok) return fail(409, `income.${routing.blocker}`);

  // Asked once for the whole range, before anything is stored: a day Fortnox
  // already holds a voucher for comes in flagged. Never throws: `checked` is
  // how it says it could not look (lib/income/duplicate.ts).
  const existing = await fortnoxIncomeVouchers(from, to);

  try {
    // Both halves of the day, because they are one voucher: the fees come out
    // of the same clearing account the sales go into.
    const [sales, fees, feeRoute] = await Promise.all([
      fetchZettleSales(from, to),
      fetchZettleFees(from, to),
      loadFeeRoute(),
    ]);
    const result = await createDayBatch(
      { source, from, to, createdById: g.actor.id },
      routeZettleSales(routing.table, sales, fees, feeRoute),
      existing,
    );

    return NextResponse.json(
      { ...result, fortnoxChecked: existing.checked, fortnoxCheckSkipped: existing.skipped },
      { status: 201 },
    );
  } catch (e) {
    // Not set up is a configuration answer, not a failure: said as itself.
    if (e instanceof ZettleNotConfiguredError) return fail(503, "income.zettleUnavailable");
    if (e instanceof ZettleError) {
      console.error(`[zettle] fetching ${source} ${from}..${to} failed`, e);
      return fail(502, "income.fetchFailed", { values: { detail: e.message } });
    }
    throw e;
  }
}
