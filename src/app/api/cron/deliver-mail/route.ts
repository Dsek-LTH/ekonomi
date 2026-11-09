// POST /api/cron/deliver-mail: retry mail still in the outbox (relay down, or stopped before sending).
import { NextResponse } from "next/server";
import { cronGate } from "@/lib/api/cron";
import { deliverPending } from "@/lib/server/notify";

export async function POST(req: Request) {
  const denied = cronGate(req);
  if (denied) return denied;

  return NextResponse.json(await deliverPending());
}
