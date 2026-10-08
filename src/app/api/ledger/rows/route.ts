// Drill-down: the individual voucher rows behind a (year, account, cost centre)
// cell in the spend report.
import { NextResponse } from "next/server";
import { fail, gate } from "@/lib/api/guard";
import { getLedgerRows } from "@/lib/ledger";
import { parseCostCenters } from "@/lib/ledger/cost-center-filter";
import { periodEnd, periodStart } from "@/lib/ledger/period";

export async function GET(req: Request) {
  const g = await gate();
  if (!g.ok) return g.res;

  const url = new URL(req.url);
  const year = Number(url.searchParams.get("year"));
  const account = url.searchParams.get("account");
  // The report's own cost-centre filter: repeated `costCenter` params, an empty
  // one for the "no cost centre" bucket, none at all for every cost centre.
  const costCenters = parseCostCenters(url.searchParams);

  if (!year || !account) {
    return fail(400, "request.yearAndAccountRequired");
  }

  // Optional period, read the way the report reads it, so the drill-down
  // covers exactly the days the row it was opened from does.
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  // A malformed end leaves the period off rather than handing the database an
  // invalid date.
  const start = from ? periodStart(from, new Date(NaN)) : null;
  const end = to ? periodEnd(to, new Date(NaN)) : null;
  const period =
    start && end && !isNaN(start.getTime()) && !isNaN(end.getTime())
      ? { from: start, to: end }
      : undefined;

  const rows = await getLedgerRows(year, account, costCenters, period);
  return NextResponse.json({ rows });
}
