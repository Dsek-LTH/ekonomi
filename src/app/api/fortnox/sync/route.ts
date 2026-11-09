// Trigger a Fortnox ledger sync. Body: { scope?: "current" | "all", financialYearId?: number }.
// "current" (default) is one fast SIE call; "all" backfills every year and is slow: prefer the CLI (pnpm fortnox:sync).
import { NextResponse } from "next/server";
import { canBookkeep } from "@/lib/domain/permissions";
import { syncLedger } from "@/lib/fortnox/sync";
import { gate } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { FortnoxSync } from "@/lib/api/schemas/admin";
import { denyNoFortnox, fortnoxFailure } from "@/lib/api/fortnox-route";

export const maxDuration = 300; // allow long backfills on platforms that honour it

export async function POST(req: Request) {
  const g = await gate(canBookkeep, "auth.bookkeeperSync");
  if (!g.ok) return g.res;
  // syncLedger fetches its own service token; this only checks a connection exists.
  const offline = await denyNoFortnox();
  if (offline) return offline;

  const parsed = await parseBody(req, FortnoxSync);
  if (!parsed.ok) return parsed.res;
  const { scope, financialYearId } = parsed.data;

  try {
    const result = await syncLedger({ scope, financialYearId });
    const vouchers = result.years.reduce((s, y) => s + y.vouchers, 0);
    return NextResponse.json({ ...result, totalVouchers: vouchers });
  } catch (e) {
    return fortnoxFailure(e);
  }
}
