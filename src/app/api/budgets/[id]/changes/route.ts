import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { gateEditorialChange } from "@/lib/budget/access";
import { resolveBudgetAccount } from "@/lib/budget/account-validation";
import { resultUnitNameForCode, getPrefixes } from "@/lib/server/result-units";
import { effectiveKind, sheetName } from "@/lib/budget";
import { fail } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { CreateChange } from "@/lib/api/schemas/budget";
import {
  parseAmount,
  scopeKey,
  scopeLabel,
  validateChange,
  type ResolvedEntry,
} from "@/lib/budget/changes";

// Entries name accounts by sheet and code: a förflyttning may fund an account the sheet does not budget yet, created with the change.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const gate = await gateEditorialChange({ budget: id });
  if (!gate.ok) return gate.res;

  const parsed = await parseBody(req, CreateChange);
  if (!parsed.ok) return parsed.res;
  const { kind, reason, entries: rawEntries } = parsed.data;

  // Required: the motivering is the point of the history.
  if (!reason) return fail(422, "budget.reasonRequired");
  if (rawEntries.length === 0) {
    return fail(422, "budget.entryRequired");
  }

  const budget = await prisma.budget.findUnique({
    where: { id },
    include: {
      costCenters: {
        include: { costCenter: { select: { code: true, name: true } }, accounts: true },
      },
    },
  });
  if (!budget) return fail(404, "budget.notFound");

  const prefixes = await getPrefixes();
  const sheets = new Map(budget.costCenters.map((cc) => [cc.id, cc]));

  // Resolve entries first; nothing is written until all of them check out.
  const resolved: ResolvedEntry[] = [];
  // Keyed on sheet and code so duplicate new accounts hit the duplicate rule.
  const toCreate = new Map<
    string,
    { budgetCostCenterId: string; accountCode: string; accountName: string }
  >();

  for (const raw of rawEntries) {
    const sheet = sheets.get(raw.costCenterId);
    if (!sheet) {
      return fail(422, "budget.sheetNotInBudget");
    }

    const amount = parseAmount(raw.amount);
    // Whole öre: a fractional value would hit the integer column and 500.
    if (!Number.isInteger(amount)) {
      return fail(422, "budget.amountsNotNumbers");
    }

    const code = raw.accountCode;
    const existing = sheet.accounts.find((a) => a.accountCode === code);

    const resultUnit = sheet.costCenter
      ? resultUnitNameForCode(sheet.costCenter.code, prefixes)
      : null;
    const withResultUnit = { ...sheet, costCenter: sheet.costCenter ? { resultUnit } : null };

    let accountId: string;
    let kindOfAccount: "INCOME" | "COST";
    if (existing) {
      accountId = existing.id;
      kindOfAccount = effectiveKind(existing.accountCode);
    } else {
      // Not yet on the sheet: must still be a real account.
      const check = await resolveBudgetAccount(code);
      if (!check.ok) return fail(422, check.error, { values: check.values });
      accountId = `new:${sheet.id}:${check.code}`;
      kindOfAccount = effectiveKind(check.code);
      if (!toCreate.has(accountId)) {
        toCreate.set(accountId, {
          budgetCostCenterId: sheet.id,
          accountCode: check.code,
          accountName: check.name,
        });
      }
    }

    resolved.push({
      accountId,
      amount,
      kind: kindOfAccount,
      scope: scopeKey(withResultUnit),
      scopeLabel: scopeLabel(withResultUnit, sheetName(sheet)),
    });
  }

  const check = validateChange(kind, resolved);
  // Full path under `errors` (lib/ui/api-error.ts prefixes `errors.`); same keys the sheet uses.
  if (!check.ok) return fail(422, `budget.changeError.${check.error}`, { values: check.values });

  const change = await prisma.$transaction(async (tx) => {
    const createdIds = new Map<string, string>();
    for (const [key, spec] of toCreate) {
      const created = await tx.budgetAccount.create({
        data: {
          budgetCostCenterId: spec.budgetCostCenterId,
          accountCode: spec.accountCode,
          accountName: spec.accountName,
        },
      });
      createdIds.set(key, created.id);
    }

    // Running number within the budget; unique [budgetId, seq] makes concurrent changes fail rather than share one.
    const last = await tx.budgetChange.findFirst({
      where: { budgetId: id },
      orderBy: { seq: "desc" },
      select: { seq: true },
    });

    return tx.budgetChange.create({
      data: {
        budgetId: id,
        seq: (last?.seq ?? 0) + 1,
        kind,
        reason,
        createdById: gate.actorId,
        entries: {
          create: resolved.map((e) => ({
            accountId: e.accountId.startsWith("new:") ? createdIds.get(e.accountId)! : e.accountId,
            amount: e.amount,
          })),
        },
      },
      include: { entries: true },
    });
  });

  return NextResponse.json(change, { status: 201 });
}
