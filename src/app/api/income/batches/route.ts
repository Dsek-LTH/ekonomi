// Fetch a date range from Zettle and store it as a batch of draft reports.
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
import { createFeeBatch, createSalesBatch } from "@/lib/income/batch";
import {
  fetchZettleFees,
  fetchZettleSales,
  IntaktError,
  IntaktNotConfiguredError,
} from "@/lib/income/client";
import { loadRoutingTable } from "@/lib/income/config";
import { fortnoxIncomeVouchers } from "@/lib/income/duplicate";
import { groupZettleFees, routeZettleSales } from "@/lib/income/routing";
import { loadBookkeepingSettings } from "@/lib/server/bookkeeping-settings";

export async function POST(req: Request) {
  const g = await gate(canBookkeep, "auth.denied");
  if (!g.ok) return g.res;

  const parsed = await parseBody(req, FetchIncome);
  if (!parsed.ok) return parsed.res;
  const { source, from, to } = parsed.data;

  if (to < from) return fail(422, "income.rangeBackwards");
  // Every day fetched becomes a report, so the whole range is in the year
  // picked in the header. Both ends in it is all of it in it.
  const offYear = (await denyOutsideFiscalYear(from)) ?? (await denyOutsideFiscalYear(to));
  if (offYear) return offYear;

  // Fees are not routed, so only sales need the table. Checked before the
  // service is asked, so a setup problem is said as one rather than after a
  // term of purchases has come back with nowhere to go.
  const routing = source === "ZETTLE_FEE" ? null : await loadRoutingTable();
  if (routing && !routing.ok) return fail(409, `income.${routing.blocker}`);

  // Asked once for the whole range, before anything is stored: a day Fortnox
  // already holds a voucher for is not imported at all, so there is nothing on
  // the review screen inviting anyone to book it a second time. Never throws:
  // `checked` is how it says it could not look (lib/income/duplicate.ts).
  const existing = await fortnoxIncomeVouchers(from, to);

  try {
    const input = { source, from, to, createdById: g.actor.id };
    const result = routing
      ? await createSalesBatch(input, routeZettleSales(routing.table, await fetchZettleSales(from, to)), existing)
      : await createFeeBatch(
          input,
          groupZettleFees(await fetchZettleFees(from, to), (await loadBookkeepingSettings()).zettleFeeAccount ?? ""),
          existing,
        );

    return NextResponse.json(
      { ...result, fortnoxChecked: existing.checked, fortnoxCheckSkipped: existing.skipped },
      { status: 201 },
    );
  } catch (e) {
    if (e instanceof IntaktNotConfiguredError) return fail(503, "income.serviceUnavailable");
    if (e instanceof IntaktError) {
      console.error(`[intakt] fetching ${source} ${from}..${to} failed`, e);
      // 503 means the service told us Zettle is not set up on its side, which
      // is a configuration answer rather than a failure, pass it through as
      // itself rather than flattening every upstream problem into one message.
      if (e.status === 503) return fail(503, "income.zettleUnavailable");
      return fail(502, "income.fetchFailed", { values: { detail: e.message } });
    }
    throw e;
  }
}
