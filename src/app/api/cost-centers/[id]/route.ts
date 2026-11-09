import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { canAccessSettings } from "@/lib/domain/permissions";
import { fail, gate } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { PatchCostCenter } from "@/lib/api/schemas/admin";
import type { CostCenter } from "@/lib/generated/prisma/client";

const admin = () => gate(canAccessSettings, "auth.adminEditCostCenter");

type Local = { ok: true; cc: CostCenter } | { ok: false; res: NextResponse };

async function loadLocal(id: string): Promise<Local> {
  const cc = await prisma.costCenter.findUnique({ where: { id } });
  if (!cc) return { ok: false, res: fail(404, "costCenter.notFound") };
  if (cc.source !== "LOCAL") {
    return {
      ok: false,
      res: fail(409, "costCenter.fortnoxOwned", { values: { code: cc.code } }),
    };
  }
  return { ok: true, cc };
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await admin();
  if (!g.ok) return g.res;
  const { id } = await ctx.params;
  const local = await loadLocal(id);
  if (!local.ok) return local.res;

  const parsed = await parseBody(req, PatchCostCenter);
  if (!parsed.ok) return parsed.res;
  const body = parsed.data;
  const data: { name?: string; active?: boolean } = {};
  if (body.name !== undefined) data.name = body.name;
  // The code is left alone: allocations and voucher lines point at this row, and the result unit is derived from it.
  if (body.active !== undefined) data.active = body.active;
  if (Object.keys(data).length === 0) return fail(422, "request.nothingToChange");

  await prisma.costCenter.update({ where: { id: local.cc.id }, data });
  return new Response(null, { status: 204 });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await admin();
  if (!g.ok) return g.res;
  const { id } = await ctx.params;
  const local = await loadLocal(id);
  if (!local.ok) return local.res;
  const { cc } = local;

  // Booked rows must keep resolving, so a cost centre in use is retired rather than deleted.
  // Income's SetNull references count too, or deleting would leave later vouchers without a cost centre.
  const counts = await Promise.all([
    prisma.expenseCostAllocation.count({ where: { costCenterId: cc.id } }),
    prisma.verificationLine.count({ where: { costCenterId: cc.id } }),
    prisma.budgetCostCenter.count({ where: { costCenterId: cc.id } }),
    prisma.resultUnitIncome.count({ where: { defaultCostCenterId: cc.id } }),
    prisma.incomeProductPrefix.count({ where: { costCenterId: cc.id } }),
    prisma.incomeLine.count({ where: { costCenterId: cc.id } }),
    prisma.incomeReport.count({ where: { costCenterId: cc.id } }),
    prisma.bookkeepingSettings.count({ where: { zettleFeeCostCenterId: cc.id } }),
  ]);
  const used = counts.reduce((a, b) => a + b, 0);
  if (used > 0) {
    if (!cc.active) {
      return fail(409, "costCenter.inUse", { values: { code: cc.code, count: used } });
    }
    await prisma.costCenter.update({ where: { id: cc.id }, data: { active: false } });
    return NextResponse.json({ retired: true, used });
  }

  await prisma.costCenter.delete({ where: { id: cc.id } });
  return NextResponse.json({ retired: false });
}
