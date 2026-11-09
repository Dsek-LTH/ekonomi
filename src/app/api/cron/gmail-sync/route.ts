// POST /api/cron/gmail-sync: renew the watch when two days from its seven-day expiry, and catch up on missed
// pushes. 404 while the integration is off. While the mailbox is not connected it does nothing and says so.
import { NextResponse } from "next/server";
import { cronGate } from "@/lib/api/cron";
import { gmailConfig } from "@/lib/server/gmail";
import { renewWatch, syncInbox } from "@/lib/server/inbound-mail";
import { fail } from "@/lib/api/guard";

export async function POST(req: Request) {
  const denied = cronGate(req);
  if (denied) return denied;
  if (!gmailConfig()) return fail(404, "notFound");

  const watch = await renewWatch();
  if (!watch) return NextResponse.json({ connected: false });
  const sync = await syncInbox();
  return NextResponse.json({ connected: true, watch, sync });
}
