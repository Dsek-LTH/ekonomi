// Import a Swish export as a batch of draft reports. The browser POSTs the raw
// CSV, with the range as query parameters, the same shape as the bank import
// (api/bank/import), which is the other place a file is handed straight to a
// parser.
//
// The bytes are passed through untouched. A Swish export is ISO-8859-1, and the
// intakt service is what knows that; decoding it here as UTF-8 on the way past
// would mangle every å, ä and ö in a message, which would surface not as an
// error but as payments quietly routed to the fallback committee.
import { NextResponse } from "next/server";

import { fail, gate } from "@/lib/api/guard";
import { intaktConfigFor } from "@/lib/api/intakt-route";
import { canAccessBookkeeping } from "@/lib/domain/permissions";
import { createSalesBatch } from "@/lib/income/batch";
import { fetchSwishReports, IntaktError, IntaktNotConfiguredError } from "@/lib/income/client";
import { fortnoxIncomeVouchers } from "@/lib/income/duplicate";

// A term's export is a couple of hundred kilobytes; this is generous against
// that and small enough that a mistaken upload cannot exhaust memory.
const MAX_BYTES = 8 * 1024 * 1024;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(req: Request) {
  const g = await gate(canAccessBookkeeping, "auth.denied");
  if (!g.ok) return g.res;

  const url = new URL(req.url);
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  const filename = url.searchParams.get("filename") ?? "swish.csv";

  if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) return fail(422, "income.rangeRequired");
  if (to < from) return fail(422, "income.rangeBackwards");

  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.byteLength === 0) return fail(400, "income.emptyFile");
  if (bytes.byteLength > MAX_BYTES) return fail(413, "income.fileTooLarge");

  const cfg = await intaktConfigFor(g.actor.id);
  if (!cfg.ok) return cfg.res;

  // The same fail-safe the Zettle route runs, for the same reason: a day
  // already booked in Fortnox is never imported, so it cannot be booked twice.
  const existing = await fortnoxIncomeVouchers(from, to);

  try {
    const reports = await fetchSwishReports(from, to, bytes, filename, cfg.config);
    if (reports.length === 0) return fail(422, "income.noReports");

    const result = await createSalesBatch(
      { source: "SWISH", from, to, filename, createdById: g.actor.id },
      reports,
      existing,
    );

    return NextResponse.json(
      { ...result, fortnoxChecked: existing.checked, fortnoxCheckSkipped: existing.skipped },
      { status: 201 },
    );
  } catch (e) {
    if (e instanceof IntaktNotConfiguredError) return fail(503, "income.serviceUnavailable");
    if (e instanceof IntaktError) {
      console.error(`[intakt] importing swish ${from}..${to} failed`, e);
      // A 400 from the service is about this file (a header it did not
      // recognise, a row it could not read) so its message is the useful part
      // and is passed through rather than replaced.
      if (e.status === 400) return fail(422, "income.csvRejected", { values: { detail: e.message } });
      return fail(502, "income.fetchFailed", { values: { detail: e.message } });
    }
    throw e;
  }
}
