// Why one member holds the roles they hold (admin only).
//
// The counterpart to the role chips in Inställningar → Användare: those say
// what somebody has, and this says what it rests on: which Authentik group
// conferred each role, and which roles nothing confers any more.
//
// Fetched per person rather than shipped with the list because it is a question
// asked about one member at a time, and answering it for every role holder
// eagerly would be the mapping re-derived a few dozen times for a panel that is
// usually closed.
import { NextResponse } from "next/server";
import { canAccessSettings } from "@/lib/domain/permissions";
import { getUserAuthority } from "@/lib/data/authority";
import { fail, gate } from "@/lib/api/guard";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await gate(canAccessSettings, "auth.adminOnly");
  if (!g.ok) return g.res;

  const { id } = await ctx.params;
  const authority = await getUserAuthority(id);
  if (!authority) return fail(404, "notFound");

  return NextResponse.json(authority);
}
