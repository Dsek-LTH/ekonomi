// Import a Swish export as a batch of draft reports. The browser POSTs the raw CSV with the range as
// query parameters. Read as bytes, not text: the export is ISO-8859-1 (lib/income/swish.ts), and
// UTF-8 decoding would mangle å, ä, ö and misroute payments to the reserv.

import { NextResponse } from "next/server";

import { fail, gate } from "@/lib/api/guard";
import { denyOutsideFiscalYear } from "@/lib/api/fiscal-year";
import { canBookkeep } from "@/lib/domain/permissions";
import { createDayBatch } from "@/lib/income/batch";
import { parseSwishPayments, SwishParseError } from "@/lib/income/swish";
import { loadRoutingTable } from "@/lib/income/config";
import { fortnoxIncomeVouchers } from "@/lib/income/duplicate";
import { routeSwishPayments } from "@/lib/income/routing";

// A term's export is a couple of hundred kilobytes; this bounds memory.
const MAX_BYTES = 8 * 1024 * 1024;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(req: Request) {
  const g = await gate(canBookkeep, "auth.denied");
  if (!g.ok) return g.res;

  const url = new URL(req.url);
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  const filename = url.searchParams.get("filename") ?? "swish.csv";

  if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) return fail(422, "income.rangeRequired");
  if (to < from) return fail(422, "income.rangeBackwards");
  // In the year picked in the header, as a Zettle fetch is.
  const offYear = (await denyOutsideFiscalYear(from)) ?? (await denyOutsideFiscalYear(to));
  if (offYear) return offYear;

  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.byteLength === 0) return fail(400, "income.emptyFile");
  if (bytes.byteLength > MAX_BYTES) return fail(413, "income.fileTooLarge");

  const routing = await loadRoutingTable();
  if (!routing.ok) return fail(409, `income.${routing.blocker}`);

  // Read first, so an unreadable file is said as that, naming the line.
  let payments;
  try {
    payments = parseSwishPayments(bytes, from, to);
  } catch (e) {
    if (e instanceof SwishParseError) {
      return fail(422, "income.csvRejected", { values: { detail: e.message } });
    }
    throw e;
  }
  const reports = routeSwishPayments(routing.table, payments);
  if (reports.length === 0) return fail(422, "income.noReports");

  // The same fail-safe as the Zettle route: a day already in Fortnox comes in flagged.
  const existing = await fortnoxIncomeVouchers(from, to);

  const result = await createDayBatch(
    { source: "SWISH", from, to, filename, createdById: g.actor.id },
    reports,
    existing,
  );

  return NextResponse.json(
    { ...result, fortnoxChecked: existing.checked, fortnoxCheckSkipped: existing.skipped },
    { status: 201 },
  );
}
