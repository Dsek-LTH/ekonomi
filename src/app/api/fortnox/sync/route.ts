// Trigger a Fortnox ledger sync. Body: { scope?: "current" | "all", year?: number }.
// Default is "current" (one SIE call — fast, safe for an interactive button).
// "all" backfills every financial year and can take a while; prefer the CLI
// (pnpm fortnox:sync) or the scheduled job for that.
import { NextResponse } from "next/server";
import { canAccessBookkeeping } from "@/lib/domain/permissions";
import { syncLedger } from "@/lib/fortnox/sync";
import { gate } from "@/lib/api/guard";
import { denyNoFortnox, fortnoxFailure } from "@/lib/api/fortnox-route";

export const maxDuration = 300; // allow long backfills on platforms that honour it

export async function POST(req: Request) {
  const g = await gate(canAccessBookkeeping, "auth.bookkeeperSync");
  if (!g.ok) return g.res;
  // syncLedger fetches its own service token, so this only has to know there is
  // a connection for it to find.
  const offline = await denyNoFortnox();
  if (offline) return offline;

  const body = await req.json().catch(() => ({}));
  const scope = body.scope === "all" ? "all" : "current";
  const year = typeof body.year === "number" ? body.year : undefined;

  try {
    const result = await syncLedger({ scope, year });
    const vouchers = result.years.reduce((s, y) => s + y.vouchers, 0);
    return NextResponse.json({ ok: true, ...result, totalVouchers: vouchers });
  } catch (e) {
    return fortnoxFailure(e);
  }
}
