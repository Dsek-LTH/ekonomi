// GET /api/expenses/presence: what is happening to which utlägg right now, for
// the Bokföring list. Polled, to mark the Bokför and Exportera buttons.
//
//   booking     who else has an utlägg's booking screen open. Advisory: it
//               marks the button and stops nothing. See lib/domain/presence.ts.
//   exporting   which utlägg are locked by an export, in progress or with an
//               outcome nobody knows yet. Not advisory: the export route
//               refuses a second export while one is held, and the list
//               disables the button to match. See lib/domain/export-claim.ts.
import { NextResponse } from "next/server";
import { canViewBookkeeping } from "@/lib/domain/permissions";
import { gate } from "@/lib/api/guard";
import { activeBookings } from "@/lib/server/presence";
import { activeExports } from "@/lib/server/export-claim";
import type { LiveBookkeeping } from "@/lib/domain/presence";

export async function GET() {
  const g = await gate(canViewBookkeeping);
  if (!g.ok) return g.res;

  const [booking, exporting] = await Promise.all([activeBookings(g.actor.id), activeExports()]);
  const live: LiveBookkeeping = { booking, exporting };
  return NextResponse.json(live);
}
