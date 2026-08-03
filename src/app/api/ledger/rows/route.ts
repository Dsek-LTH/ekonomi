// Drill-down: the individual voucher rows behind a (year, account, cost centre)
// cell in the spend report.
import { NextResponse } from "next/server";
import { fail, gate } from "@/lib/api/guard";
import { getLedgerRows } from "@/lib/ledger";

export async function GET(req: Request) {
  const g = await gate();
  if (!g.ok) return g.res;

  const url = new URL(req.url);
  const year = Number(url.searchParams.get("year"));
  const account = url.searchParams.get("account");
  // `costCenter=CODE` scopes to one cost centre, `costCenter=` (empty) to the
  // "no cost centre" bucket, and omitting it spans them all.
  const ccParam = url.searchParams.get("costCenter");
  const costCenter = ccParam === null ? undefined : ccParam || null;

  if (!year || !account) {
    return fail(400, "request.yearAndAccountRequired");
  }

  // Optional period, so the drill-down matches the report's month range.
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const period =
    from && to
      ? {
          from: new Date(`${from}-01T00:00:00Z`),
          to: new Date(Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5, 7)), 0)),
        }
      : undefined;

  const rows = await getLedgerRows(year, account, costCenter, period);
  return NextResponse.json({ rows });
}
