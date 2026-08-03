import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { denyBudgetWrite } from "@/lib/budget/access";
import { resolveBudgetAccount } from "@/lib/budget/account-validation";
import { fail } from "@/lib/api/guard";

export async function POST(req: Request, ctx: { params: Promise<{ id: string; ccid: string }> }) {
  const { ccid: budgetCostCenterId } = await ctx.params;
  const denied = await denyBudgetWrite({ costCenter: budgetCostCenterId });
  if (denied) return denied;

  const body = await req.json().catch(() => ({}));
  // Optional: pin the income/cost classification (used when adding inside a
  // specific section so the new account lands there regardless of its code).
  const kindOverride = body.kindOverride === "INCOME" || body.kindOverride === "COST" ? body.kindOverride : null;

  // The code must exist in the synced chart; the name comes from there too, so
  // a budget can't drift from what the ledger will report against.
  const check = await resolveBudgetAccount(
    typeof body.accountCode === "string" ? body.accountCode : "",
  );
  if (!check.ok) return fail(422, check.error, { values: check.values });
  const accountCode = check.code;
  const accountName = check.name;

  const last = await prisma.budgetAccount.findFirst({ where: { budgetCostCenterId }, orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
  const account = await prisma.budgetAccount.create({
    data: { budgetCostCenterId, accountCode, accountName, kindOverride, sortOrder: (last?.sortOrder ?? -1) + 1 },
    include: { lineItems: true, comments: true },
  });
  return NextResponse.json(account, { status: 201 });
}
