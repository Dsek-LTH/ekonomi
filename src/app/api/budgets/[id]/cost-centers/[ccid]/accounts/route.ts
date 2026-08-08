import { NextResponse } from "next/server";
import { appendInOrder, nextSortOrder } from "@/lib/server/sort-order";
import { denyBudgetWrite } from "@/lib/budget/access";
import { resolveBudgetAccount } from "@/lib/budget/account-validation";
import { fail } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { CreateAccount } from "@/lib/api/schemas/budget";

export async function POST(req: Request, ctx: { params: Promise<{ id: string; ccid: string }> }) {
  const { ccid: budgetCostCenterId } = await ctx.params;
  const denied = await denyBudgetWrite({ costCenter: budgetCostCenterId });
  if (denied) return denied;

  const parsed = await parseBody(req, CreateAccount);
  if (!parsed.ok) return parsed.res;
  // Optional: pin the income/cost classification (used when adding inside a
  // specific section so the new account lands there regardless of its code).
  const kindOverride = parsed.data.kindOverride ?? null;

  // The code must exist in the synced chart; the name comes from there too, so
  // a budget can't drift from what the ledger will report against.
  const check = await resolveBudgetAccount(parsed.data.accountCode);
  if (!check.ok) return fail(422, check.error, { values: check.values });
  const accountCode = check.code;
  const accountName = check.name;

  const account = await appendInOrder({ model: "budgetCostCenter", id: budgetCostCenterId }, async (tx) => {
    const last = await tx.budgetAccount.findFirst({ where: { budgetCostCenterId }, orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
    return tx.budgetAccount.create({
      data: { budgetCostCenterId, accountCode, accountName, kindOverride, sortOrder: nextSortOrder(last) },
      include: { lineItems: true, comments: true },
    });
  });
  return NextResponse.json(account, { status: 201 });
}
