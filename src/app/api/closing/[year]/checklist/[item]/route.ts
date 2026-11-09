import { prisma } from "@/lib/server/db";
import { fail, gate } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { ChecklistItemPatch } from "@/lib/api/schemas/closing";
import { canBookkeep } from "@/lib/domain/permissions";

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ year: string; item: string }> },
) {
  const g = await gate(canBookkeep);
  if (!g.ok) return g.res;

  const parsed = await parseBody(req, ChecklistItemPatch);
  if (!parsed.ok) return parsed.res;
  const { done, note, noteToNextYear } = parsed.data;

  const { year, item: id } = await ctx.params;
  const item = await prisma.checklistItem.findUnique({
    where: { id },
    select: { financialYear: true, check: true },
  });
  if (!item || String(item.financialYear) !== year) return fail(404, "closing.itemNotFound");
  // Items the app answers itself cannot be ticked by hand.
  if (done !== undefined && item.check) return fail(422, "closing.itemHasCheck");

  await prisma.checklistItem.update({
    where: { id },
    data: {
      ...(done === undefined
        ? {}
        : done
          ? { doneAt: new Date(), doneById: g.actor.id }
          : { doneAt: null, doneById: null }),
      ...(note === undefined ? {} : { note }),
      ...(noteToNextYear === undefined ? {} : { noteToNextYear }),
    },
  });
  return new Response(null, { status: 204 });
}
