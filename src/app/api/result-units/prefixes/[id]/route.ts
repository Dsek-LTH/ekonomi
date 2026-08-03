// Remove a cost-centre code prefix (admin only). The cost centres it claimed
// fall back to having no result unit until another prefix picks them up.
import { prisma } from "@/lib/server/db";
import { canAccessSettings } from "@/lib/domain/permissions";
import { gate } from "@/lib/api/guard";

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await gate(canAccessSettings, "auth.adminOnly");
  if (!g.ok) return g.res;

  await prisma.resultUnitPrefix.delete({ where: { id } }).catch(() => null);
  return new Response(null, { status: 204 });
}
