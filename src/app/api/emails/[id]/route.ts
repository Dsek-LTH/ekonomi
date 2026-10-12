// GET /api/emails/[id]: one mail's subject and both bodies, for the preview in
// the log. Fetched one at a time because the bodies are most of a row's
// weight, and a page of the log only needs the lines above them.
import { NextResponse } from "next/server";
import { canAccessSettings } from "@/lib/domain/permissions";
import { getEmailBody } from "@/lib/data/emails";
import { fail, gate } from "@/lib/api/guard";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await gate(canAccessSettings, "auth.adminOnly");
  if (!g.ok) return g.res;

  const { id } = await ctx.params;
  const body = await getEmailBody(id);
  if (!body) return fail(404, "notFound");
  return NextResponse.json(body);
}
