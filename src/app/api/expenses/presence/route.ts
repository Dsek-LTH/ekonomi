// GET /api/expenses/presence: polled by the Bokföring list. Booking and reviewing are advisory,
// exporting is a real lock (lib/domain/export-claim.ts) that the export route enforces.
import { NextResponse } from "next/server";
import { canViewBookkeeping } from "@/lib/domain/permissions";
import { gate } from "@/lib/api/guard";
import { activePresence } from "@/lib/server/presence";
import { activeExports } from "@/lib/server/export-claim";
import type { LiveBookkeeping } from "@/lib/domain/presence";

export async function GET() {
  const g = await gate(canViewBookkeeping);
  if (!g.ok) return g.res;

  const [presence, exporting] = await Promise.all([activePresence(g.actor.id), activeExports()]);
  const live: LiveBookkeeping = { booking: presence.book, reviewing: presence.review, exporting };
  return NextResponse.json(live);
}
