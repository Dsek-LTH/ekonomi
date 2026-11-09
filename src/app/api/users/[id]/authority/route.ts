// Why one member holds their roles (admin only): which Authentik group conferred each role, and
// which roles nothing confers any more. Per person, since it is asked about one member at a time.

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
