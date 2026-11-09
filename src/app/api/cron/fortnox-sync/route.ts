// POST /api/cron/fortnox-sync: nightly 04:00 sync through the service connection (syncAll).
// A failed step is a 502 with the whole result; each step replaces whole, so a retry is safe.
import { NextResponse } from "next/server";
import { cronGate } from "@/lib/api/cron";
import { fail } from "@/lib/api/guard";
import { denyNoFortnox, fortnoxFailure } from "@/lib/api/fortnox-route";
import { fortnoxConfigured } from "@/lib/fortnox";
import { syncAll } from "@/lib/fortnox/sync";

export const maxDuration = 300;

export async function POST(req: Request) {
  const denied = cronGate(req);
  if (denied) return denied;
  if (!fortnoxConfigured()) return fail(404, "notFound");
  const offline = await denyNoFortnox();
  if (offline) return offline;

  let result;
  try {
    result = await syncAll();
  } catch (e) {
    return fortnoxFailure(e);
  }
  if (!result) return NextResponse.json({ skipped: "running" }, { status: 202 });

  const failed =
    Object.values(result).some((s) => !Array.isArray(s) && !s.ok) ||
    result.ledger.some((s) => !s.ok);
  return NextResponse.json(result, { status: failed ? 502 : 200 });
}
