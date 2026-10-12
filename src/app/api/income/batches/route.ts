// Fetch a date range from Zettle and store it as a batch of draft reports.
//
// Swish is not here: it arrives as an uploaded CSV rather than a JSON body, so
// it has its own route (./swish). Everything after the fetch is shared, see
// lib/income/batch.ts.
import { NextResponse } from "next/server";

import { fail, gate } from "@/lib/api/guard";
import { intaktConfigFor } from "@/lib/api/intakt-route";
import { parseBody } from "@/lib/api/parse";
import { FetchIncome } from "@/lib/api/schemas/income";
import { canAccessBookkeeping } from "@/lib/domain/permissions";
import { createFeeBatch, createSalesBatch } from "@/lib/income/batch";
import {
  fetchFeeReports,
  fetchZettleReports,
  IntaktError,
  IntaktNotConfiguredError,
} from "@/lib/income/client";
import { fortnoxIncomeVouchers } from "@/lib/income/duplicate";

export async function POST(req: Request) {
  const g = await gate(canAccessBookkeeping, "auth.denied");
  if (!g.ok) return g.res;

  const parsed = await parseBody(req, FetchIncome);
  if (!parsed.ok) return parsed.res;
  const { source, from, to } = parsed.data;

  if (to < from) return fail(422, "income.rangeBackwards");

  const cfg = await intaktConfigFor(g.actor.id);
  if (!cfg.ok) return cfg.res;

  // Asked once for the whole range, before anything is stored: a day Fortnox
  // already holds a voucher for is not imported at all, so there is nothing on
  // the review screen inviting anyone to book it a second time. Never throws:
  // `checked` is how it says it could not look (lib/income/duplicate.ts).
  const existing = await fortnoxIncomeVouchers(from, to);

  try {
    const input = { source, from, to, createdById: g.actor.id };
    const result =
      source === "ZETTLE_FEE"
        ? await createFeeBatch(input, await fetchFeeReports(from, to, cfg.config), existing)
        : await createSalesBatch(input, await fetchZettleReports(from, to, cfg.config), existing);

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
