// Edit or delete a product-name prefix.
import { NextResponse } from "next/server";

import { fail, gate, orNotFound } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { UpdateIncomePrefix } from "@/lib/api/schemas/income";
import { canAccessSettings } from "@/lib/domain/permissions";
import { prisma } from "@/lib/server/db";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const g = await gate(canAccessSettings, "auth.adminOnly");
  if (!g.ok) return g.res;

  const parsed = await parseBody(req, UpdateIncomePrefix);
  if (!parsed.ok) return parsed.res;
  const { incomeId, account, costCenterId } = parsed.data;

  if (incomeId) {
    const income = await prisma.resultUnitIncome.findUnique({ where: { id: incomeId } });
    if (!income) return fail(422, "income.committeeNotFound");
  }

  if (costCenterId) {
    const cc = await prisma.costCenter.findUnique({ where: { id: costCenterId } });
    if (!cc) return fail(422, "income.unknownCostCenter");
  }

  const updated = await orNotFound(
    () =>
      prisma.incomeProductPrefix.update({
        where: { id },
        data: {
          ...(incomeId !== undefined && { incomeId }),
          ...(account !== undefined && { account }),
          ...(costCenterId !== undefined && { costCenterId }),
        },
        select: { id: true },
      }),
    "income.prefixNotFound",
  );
  if (updated instanceof NextResponse) return updated;

  return new Response(null, { status: 204 });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const g = await gate(canAccessSettings, "auth.adminOnly");
  if (!g.ok) return g.res;

  const prefix = await prisma.incomeProductPrefix.findUnique({ where: { id } });
  if (!prefix) return fail(404, "income.prefixNotFound");

  // Prefixes carry no history (lines record the account, not the rule), so this is a real delete.
  await prisma.incomeProductPrefix.delete({ where: { id } });
  return new Response(null, { status: 204 });
}
