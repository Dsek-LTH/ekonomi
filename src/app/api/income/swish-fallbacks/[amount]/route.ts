// Remove a Swish amount fallback. Keyed by the amount in öre, which is the row.
import { fail, gate, orNotFound } from "@/lib/api/guard";
import { canAccessSettings } from "@/lib/domain/permissions";
import { prisma } from "@/lib/server/db";
import { NextResponse } from "next/server";

export async function DELETE(_req: Request, ctx: { params: Promise<{ amount: string }> }) {
  const { amount } = await ctx.params;

  const g = await gate(canAccessSettings, "auth.adminOnly");
  if (!g.ok) return g.res;

  const ore = Number(amount);
  // From the path rather than a body, so it is worth checking rather than
  // trusting: a non-integer here would reach Postgres as a type error.
  if (!Number.isInteger(ore)) return fail(422, "request.invalidBody");

  const deleted = await orNotFound(
    () => prisma.swishAmountFallback.delete({ where: { amount: ore } }),
    "income.fallbackNotFound",
  );
  if (deleted instanceof NextResponse) return deleted;

  return new Response(null, { status: 204 });
}
