// Removing a day. Line corrections are in ./lines.
import { NextResponse } from "next/server";

import { fail, gate } from "@/lib/api/guard";
import { canBookkeep, canUnexport } from "@/lib/domain/permissions";
import { deleteIncomeReport } from "@/lib/income/lifecycle";
import { prisma } from "@/lib/server/db";
import { lifecycleFailure } from "./lifecycle-failure";

/** Remove a day. Treasury roles, refused while exported (lib/income/lifecycle.ts). Bookkeeping may clear a draft. */
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
