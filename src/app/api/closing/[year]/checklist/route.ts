import { fail, gate } from "@/lib/api/guard";
import { canBookkeep } from "@/lib/domain/permissions";
import { getClosingYear } from "@/lib/data/closing";
import { startChecklist } from "@/lib/data/closing-checklist";

// Start a year's checklist: copy the template into it, as it stands today.
export async function POST(_req: Request, ctx: { params: Promise<{ year: string }> }) {
  const g = await gate(canBookkeep);
  if (!g.ok) return g.res;

  const id = Number((await ctx.params).year);
  const year = Number.isInteger(id) ? await getClosingYear(id) : null;
  if (!year) return fail(404, "closing.yearNotFound");

  if (!(await startChecklist(year))) return fail(409, "closing.checklistStarted");
  return new Response(null, { status: 204 });
}
