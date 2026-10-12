// POST /api/emails/[id]/retry: try an unsent mail again now, with all its tries
// given back. For a mail the outbox has given up on, once whatever stopped it
// (the relay, an address) has been put right. See `retryEmail`.
import { NextResponse } from "next/server";
import { canAccessSettings } from "@/lib/domain/permissions";
import { deliverSoon, retryEmail } from "@/lib/server/notify";
import { fail, gate } from "@/lib/api/guard";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await gate(canAccessSettings, "auth.adminOnly");
  if (!g.ok) return g.res;

  const { id } = await ctx.params;
  if (!(await retryEmail(id))) return fail(409, "email.notRetryable");
  deliverSoon();
  return new NextResponse(null, { status: 204 });
}
