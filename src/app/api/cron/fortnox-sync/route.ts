// POST /api/cron/fortnox-sync: the nightly sync from Fortnox, at 04:00.
//
// Everything the app mirrors (registers, supplier register, this year's and
// last year's ledger) through the service connection, so it needs nobody to
// be logged in. See syncAll in lib/fortnox/sync.ts.
//
// The status says whether the CronJob should count it as a failure. A step
// that failed is a 502 with the whole result in the body, so the job's log
// says which one. Each step replaces what it mirrors whole, so a retry is safe.
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
  // No integration on this deployment, the same answer gmail-sync gives.
  if (!fortnoxConfigured()) return fail(404, "notFound");
  const offline = await denyNoFortnox();
  if (offline) return offline;

  let result;
  try {
    result = await syncAll();
  } catch (e) {
    return fortnoxFailure(e);
  }
  // Somebody pressed "Synka allt nu" a moment ago. Theirs is the run.
  if (!result) return NextResponse.json({ skipped: "running" }, { status: 202 });

  const failed =
    Object.values(result).some((s) => !Array.isArray(s) && !s.ok) || result.ledger.some((s) => !s.ok);
  return NextResponse.json(result, { status: failed ? 502 : 200 });
}
