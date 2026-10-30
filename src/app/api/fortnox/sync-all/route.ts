// POST /api/fortnox/sync-all: the nightly sync, started by hand from the
// Fortnox settings page. See syncAll in lib/fortnox/sync.ts.
import { NextResponse } from "next/server";
import { canAccessSettings } from "@/lib/domain/permissions";
import { syncAll } from "@/lib/fortnox/sync";
import { fail, gate } from "@/lib/api/guard";
import { denyNoFortnox, fortnoxFailure } from "@/lib/api/fortnox-route";

export const maxDuration = 300;

export async function POST() {
  const g = await gate(canAccessSettings, "auth.adminSyncChart");
  if (!g.ok) return g.res;
  const offline = await denyNoFortnox();
  if (offline) return offline;

  try {
    const result = await syncAll();
    if (!result) return fail(409, "fortnox.syncRunning");
    return NextResponse.json(result);
  } catch (e) {
    return fortnoxFailure(e);
  }
}
