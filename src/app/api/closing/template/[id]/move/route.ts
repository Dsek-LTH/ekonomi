import { prisma } from "@/lib/server/db";
import { fail, gate } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { TemplateMoveBody } from "@/lib/api/schemas/closing";
import { canAccessSettings } from "@/lib/domain/permissions";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await gate(canAccessSettings, "auth.adminOnly");
  if (!g.ok) return g.res;
  const parsed = await parseBody(req, TemplateMoveBody);
  if (!parsed.ok) return parsed.res;
  const { id } = await ctx.params;

  return prisma.$transaction(async (tx) => {
    const steps = await tx.checklistTemplateItem.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: "asc" }, { title: "asc" }],
      select: { id: true },
    });
    const at = steps.findIndex((s) => s.id === id);
    if (at === -1) return fail(404, "closing.templateItemNotFound");
    const to = parsed.data.direction === "up" ? at - 1 : at + 1;
    if (to < 0 || to >= steps.length) return new Response(null, { status: 204 });

    // Renumbered in steps of ten so ties or gaps from earlier edits cannot make the swap a no-op.
    [steps[at], steps[to]] = [steps[to], steps[at]];
    for (const [i, s] of steps.entries()) {
      await tx.checklistTemplateItem.update({
        where: { id: s.id },
        data: { sortOrder: (i + 1) * 10 },
      });
    }
    return new Response(null, { status: 204 });
  });
}
