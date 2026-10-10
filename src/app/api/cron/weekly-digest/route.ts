// POST /api/cron/weekly-digest: queue this week's digest and send it.
//
// Scheduled for Sunday evening by the CronJob. Safe to call more than once in a
// week: each member's digest carries a key for the ISO week, and a second one
// is dropped (lib/server/weekly-digest.ts).
import { NextResponse } from "next/server";
import { cronGate } from "@/lib/api/cron";
import { deliverPending } from "@/lib/server/notify";
import { queueWeeklyDigest } from "@/lib/server/weekly-digest";

export async function POST(req: Request) {
  const denied = cronGate(req);
  if (denied) return denied;

  const { queued } = await queueWeeklyDigest();
  const { sent, failed } = await deliverPending();
  return NextResponse.json({ queued, sent, failed });
}
