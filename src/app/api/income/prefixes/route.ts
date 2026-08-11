// Create a product-name prefix: the rule that routes "s1 - Öl" to
// Sexmästeriet's beer account.
import { NextResponse } from "next/server";

import { fail, gate } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { CreateIncomePrefix } from "@/lib/api/schemas/income";
import { canAccessSettings } from "@/lib/domain/permissions";
import { prisma } from "@/lib/server/db";

export async function POST(req: Request) {
  const g = await gate(canAccessSettings, "auth.adminOnly");
  if (!g.ok) return g.res;

  const parsed = await parseBody(req, CreateIncomePrefix);
  if (!parsed.ok) return parsed.res;
  const { code, incomeId, account, isFallback } = parsed.data;

  const existing = await prisma.incomeProductPrefix.findUnique({ where: { code } });
  if (existing) return fail(409, "income.prefixExists", { values: { code } });

  const income = await prisma.resultUnitIncome.findUnique({ where: { id: incomeId } });
  if (!income) return fail(422, "income.committeeNotFound");

  // Exactly one prefix is the fallback, guarded by a partial unique index. The
  // old one is cleared in the same transaction, so claiming it is a move rather
  // than a collision the caller has to resolve.
  const prefix = await prisma.$transaction(async (tx) => {
    if (isFallback) {
      await tx.incomeProductPrefix.updateMany({
        where: { isFallback: true },
        data: { isFallback: false },
      });
    }
    return tx.incomeProductPrefix.create({
      data: { code, incomeId, account, isFallback: isFallback ?? false },
    });
  });

  return NextResponse.json({ id: prefix.id }, { status: 201 });
}
