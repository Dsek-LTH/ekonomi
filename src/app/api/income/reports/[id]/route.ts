// The one review edit a fetched report takes: which cost centre it books
// against.
//
// This is the field that replaced hand-editing pending.yaml. The manifest's
// other use — deleting a line to skip the day — has no counterpart any more:
// a day is booked or it is not, and an unbooked one needs no state saying so.
import { NextResponse } from "next/server";

import { fail, gate, orNotFound } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { UpdateIncomeReport } from "@/lib/api/schemas/income";
import { canAccessBookkeeping, canUnexport } from "@/lib/domain/permissions";
import { deleteIncomeReport } from "@/lib/income/lifecycle";
import { prisma } from "@/lib/server/db";
import { lifecycleFailure } from "./lifecycle-failure";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const g = await gate(canAccessBookkeeping, "auth.denied");
  if (!g.ok) return g.res;

  const parsed = await parseBody(req, UpdateIncomeReport);
  if (!parsed.ok) return parsed.res;
  const { costCenterId } = parsed.data;

  const report = await prisma.incomeReport.findUnique({
    where: { id },
    select: { id: true, status: true },
  });
  if (!report) return fail(404, "income.reportNotFound");

  // Once booked, the voucher is what says where this money went. Changing the
  // cost centre afterwards would leave the report and the verifikation
  // disagreeing about it, and the verifikation is the one Fortnox has.
  if (report.status !== "DRAFT") {
    return fail(409, "income.editOnlyBeforeBooking", {
      values: { status: { key: `income.status.${report.status}` } },
    });
  }

  if (costCenterId) {
    const cc = await prisma.costCenter.findUnique({ where: { id: costCenterId } });
    if (!cc) return fail(422, "income.unknownCostCenter");
  }

  const updated = await orNotFound(
    () =>
      prisma.incomeReport.update({
        where: { id },
        data: { ...(costCenterId !== undefined && { costCenterId }) },
        select: { id: true, status: true, costCenterId: true },
      }),
    "income.reportNotFound",
  );
  if (updated instanceof NextResponse) return updated;

  return NextResponse.json(updated);
}

/**
 * Remove a day: the report, its sold lines and its verifikation.
 *
 * Behind the treasury roles rather than bookkeeping access, and refused while
 * the day is exported — see lib/income/lifecycle.ts, which is where both rules
 * and the reasons for them live.
 *
 * With one exception: an empty draft. Bookkeeping can make those (POST
 * ../reports — a report for a verksamhet the routing never saw, to move sales
 * onto) and one made by mistake is a row holding no lines, no total and no
 * verifikation. Requiring a skattmästare to come and clear it away would make
 * the button that creates it a thing you think twice about pressing, which is
 * the opposite of what it is for.
 */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const g = await gate(canAccessBookkeeping, "auth.denied");
  if (!g.ok) return g.res;

  if (!canUnexport(g.actor.roles)) {
    const empty = await prisma.incomeReport.findFirst({
      where: { id, status: "DRAFT", lines: { none: {} } },
      select: { id: true },
    });
    if (!empty) return fail(403, "income.noUnexportAccess");
  }

  const result = await deleteIncomeReport(id);
  if (!result.ok) return lifecycleFailure(result);

  return NextResponse.json({ id, deleted: true });
}
