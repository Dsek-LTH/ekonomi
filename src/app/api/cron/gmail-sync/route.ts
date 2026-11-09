// POST /api/cron/gmail-sync: renew the watch when two days from its seven-day expiry, and catch up on missed pushes.
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
