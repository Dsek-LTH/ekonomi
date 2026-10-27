// POST /api/cron/gmail-sync: keep the levfaktura inkorg mailbox watched, and
// catch up on anything a push missed.
//
// Gmail's watch lasts seven days, and this renews it when it is two days from
// running out, so once a day is enough for that. Running it hourly also makes
// it the safety net for the push: a notification Pub/Sub never delivered is a
// mail that arrives an hour late rather than not at all.
import { NextResponse } from "next/server";
import { cronGate } from "@/lib/api/cron";
import { renewWatch, syncInbox } from "@/lib/server/inbound-mail";
import { fail } from "@/lib/api/guard";

export async function POST(req: Request) {
  const denied = cronGate(req);
  if (denied) return denied;

  const watch = await renewWatch();
  if (!watch) return fail(404, "notFound");
  const sync = await syncInbox();
  return NextResponse.json({ watch, sync });
}
