// Trigger a Fortnox ledger sync. Body:
// { scope?: "current" | "all", financialYearId?: number }.
// Default is "current" (one SIE call — fast, safe for an interactive button).
// "all" backfills every financial year and can take a while; prefer the CLI
// (pnpm fortnox:sync) or the scheduled job for that.
import { NextResponse } from "next/server";
import { canAccessBookkeeping } from "@/lib/domain/permissions";
import { syncLedger } from "@/lib/fortnox/sync";
import { gate } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { FortnoxSync } from "@/lib/api/schemas/admin";
import { denyNoFortnox, fortnoxFailure } from "@/lib/api/fortnox-route";

export const maxDuration = 300; // allow long backfills on platforms that honour it

export async function POST(req: Request) {
  const g = await gate(canAccessBookkeeping, "auth.bookkeeperSync");
  if (!g.ok) return g.res;
  // syncLedger fetches its own service token, so this only has to know there is
  // a connection for it to find.
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
