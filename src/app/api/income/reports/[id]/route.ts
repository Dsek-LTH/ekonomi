// Removing a day. Where its lines book is corrected line by line (./lines);
// the report itself has nothing left to edit.
import { NextResponse } from "next/server";

import { fail, gate } from "@/lib/api/guard";
import { canBookkeep, canUnexport } from "@/lib/domain/permissions";
import { deleteIncomeReport } from "@/lib/income/lifecycle";
import { prisma } from "@/lib/server/db";
import { lifecycleFailure } from "./lifecycle-failure";

/**
 * Remove a day: the report, its sold lines and its verifikation.
 *
 * Behind the treasury roles rather than bookkeeping access, and refused while
 * the day is exported, see lib/income/lifecycle.ts, which is where both rules
 * and the reasons for them live.
 *
 * With one exception: a draft. It is the working set of a fetch, which the
 * next fetch replaces anyway, so bookkeeping may clear one away.
 */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const g = await gate(canBookkeep, "auth.denied");
  if (!g.ok) return g.res;

  if (!canUnexport(g.actor.capabilities)) {
    const draft = await prisma.incomeReport.findFirst({
      where: { id, status: "DRAFT" },
      select: { id: true },
    });
    if (!draft) return fail(403, "income.noUnexportAccess");
  }

  const result = await deleteIncomeReport(id);
  if (!result.ok) return lifecycleFailure(result);

  return NextResponse.json({ id, deleted: true });
}
