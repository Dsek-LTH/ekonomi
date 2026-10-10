// POST /api/cron/deliver-mail: send whatever is still waiting in the outbox.
//
// Mail normally goes out right after the request that caused it. This is the
// retry: a relay that was down, or a server that stopped before it got round to
// sending. Every quarter of an hour is plenty.
import { NextResponse } from "next/server";
import { cronGate } from "@/lib/api/cron";
import { deliverPending } from "@/lib/server/notify";

export async function POST(req: Request) {
  const denied = cronGate(req);
  if (denied) return denied;

  return NextResponse.json(await deliverPending());
}
