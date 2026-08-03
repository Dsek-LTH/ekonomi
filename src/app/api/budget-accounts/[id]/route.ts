import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { denyBudgetWrite, denyDeletingAdjusted } from "@/lib/budget/access";
import { resolveBudgetAccount } from "@/lib/budget/account-validation";
import { fail } from "@/lib/api/guard";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const denied = await denyBudgetWrite({ account: id });
  if (denied) return denied;

  const body = await req.json().catch(() => ({}));
  const data: Record<string, unknown> = {};
  // Changing the code re-resolves against the chart and pulls the name with it,
  // so the two can't disagree. The name isn't editable on its own any more.
  if (typeof body.accountCode === "string" && body.accountCode.trim()) {
    const check = await resolveBudgetAccount(body.accountCode);
    if (!check.ok) return fail(422, check.error, { values: check.values });
    data.accountCode = check.code;
    data.accountName = check.name;
  }
  if (typeof body.sortOrder === "number") data.sortOrder = body.sortOrder;
  // kindOverride: "INCOME" | "COST" sets the override; "" / null clears it
  // (falling back to code-based inference).
  if ("kindOverride" in body) {
    data.kindOverride = body.kindOverride === "INCOME" || body.kindOverride === "COST"
      ? body.kindOverride : null;
  }

  const account = await prisma.budgetAccount.update({ where: { id }, data });
  return NextResponse.json(account);
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const denied = await denyBudgetWrite({ account: id });
  if (denied) return denied;
  const adjusted = await denyDeletingAdjusted({ account: id });
  if (adjusted) return adjusted;
  await prisma.budgetAccount.delete({ where: { id } });
  return new Response(null, { status: 204 });
}
