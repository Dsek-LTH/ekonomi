// POST /api/cron/weekly-digest: safe to repeat, digests carry an ISO-week key (lib/server/weekly-digest.ts).
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
