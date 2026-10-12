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
  // Optional: pin the income/cost classification (used when adding inside a
  // specific section so the new account lands there regardless of its code).

  // The code must exist in the synced chart; the name comes from there too, so
  // a budget can't drift from what the ledger will report against.
  // The section it is being added under is checked, not stored: 3xxx belongs
  // under Intäkter and 4xxx-8xxx under Kostnader, and a code that does not
  // match the section asking for it is refused rather than filed there anyway.
  const check = await resolveBudgetAccount(parsed.data.accountCode, parsed.data.kind);
  if (!check.ok) return fail(422, check.error, { values: check.values });
  const accountCode = check.code;
  const accountName = check.name;

  // A plain insert. It used to run inside `appendInOrder`, which locks the
  // parent so that a `MAX(sortOrder) + 1` read inside it is still the answer
  // when the write lands. There is no sortOrder to compute any more: the sheet
  // is ordered by account code, and two people adding the same account at once
  // are stopped by @@unique([budgetCostCenterId, accountCode]) in the database
  // rather than by a lock held in front of it.
  const account = await prisma.budgetAccount.create({
    data: { budgetCostCenterId, accountCode, accountName },
    include: { lineItems: true, comments: true },
  });
  return NextResponse.json(account, { status: 201 });
}
