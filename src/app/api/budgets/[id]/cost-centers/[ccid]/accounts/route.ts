import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { allowBudgetWrite } from "@/lib/budget/access";
import { resolveBudgetAccount } from "@/lib/budget/account-validation";
import { fail } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { CreateAccount } from "@/lib/api/schemas/budget";

export async function POST(req: Request, ctx: { params: Promise<{ id: string; ccid: string }> }) {
  const { ccid: budgetCostCenterId } = await ctx.params;
  const g = await allowBudgetWrite({ costCenter: budgetCostCenterId });
  if (!g.ok) return g.res;

  const parsed = await parseBody(req, CreateAccount);
  if (!parsed.ok) return parsed.res;

  // The code must exist in the synced chart (the name comes from there). 3xxx belongs under Intäkter and 4xxx-8xxx under Kostnader, else refused.
  const check = await resolveBudgetAccount(parsed.data.accountCode, parsed.data.kind);
  if (!check.ok) return fail(422, check.error, { values: check.values });
  const accountCode = check.code;
  const accountName = check.name;

  // Concurrent adds of the same account are stopped by @@unique([budgetCostCenterId, accountCode]).
  const account = await prisma.budgetAccount.create({
    data: { budgetCostCenterId, accountCode, accountName },
    include: { lineItems: true, comments: true },
  });
  return NextResponse.json(account, { status: 201 });
}
