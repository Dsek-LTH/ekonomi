import { prisma } from "@/lib/server/db";
import { fail, gate } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { TemplateItemPatch } from "@/lib/api/schemas/closing";
import { canAccessSettings } from "@/lib/domain/permissions";

// Retire with `active: false`, never delete: a year started from it still names it.
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await gate(canAccessSettings, "auth.adminOnly");
  if (!g.ok) return g.res;
  const parsed = await parseBody(req, TemplateItemPatch);
  if (!parsed.ok) return parsed.res;

  const { id } = await ctx.params;
  const { count } = await prisma.checklistTemplateItem.updateMany({
    where: { id },
    data: parsed.data,
  });
  if (count === 0) return fail(404, "closing.templateItemNotFound");
  return new Response(null, { status: 204 });
}
