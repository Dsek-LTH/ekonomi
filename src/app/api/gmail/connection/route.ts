// DELETE /api/gmail/connection: disconnect the inkorg mailbox. Stops the watch, withdraws the login at
// Google and forgets it.
import { NextResponse } from "next/server";
import { disconnectMailbox } from "@/lib/server/inbound-mail";
import { canAccessSettings } from "@/lib/domain/permissions";
import { gate } from "@/lib/api/guard";

export async function DELETE() {
  const g = await gate(canAccessSettings);
  if (!g.ok) return g.res;
  await disconnectMailbox();
  return new NextResponse(null, { status: 204 });
}
