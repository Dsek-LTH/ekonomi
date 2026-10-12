// Recording a redaktionell ändring on a locked budget: ett budgetavsteg eller
// en budgetförflyttning. See BudgetChange in schema.prisma for what those are
// and lib/budget/changes.ts for the rules the entries have to satisfy.
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

// An entry names its account by where it sits (the sheet and the account code)
// rather than by id, because a förflyttning is allowed to fund a post the sheet
// doesn't budget for yet. Then there is no id to send, and the account is
// created as part of the change.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const gate = await gateEditorialChange({ budget: id });
  if (!gate.ok) return gate.res;

  const parsed = await parseBody(req, CreateChange);
  if (!parsed.ok) return parsed.res;
  const { kind, reason, entries: rawEntries } = parsed.data;

  // The motivering is the point of the history. A list of amounts explains
  // nothing on its own, so it is required rather than encouraged. The schema
  // says it is a string; that it says something is this route's rule.
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

  // Resolve every entry down to something the rules can be applied to, and
  // collect the accounts that don't exist yet. Nothing is written until all of
  // them check out. A half-recorded change is worse than a refused one.
  const resolved: ResolvedEntry[] = [];
  // Keyed on the sheet and code it will have, so two entries naming the same
  // not-yet-existing account resolve to one id and the duplicate is caught by
  // the same rule as any other duplicate, rather than by a unique constraint.
  const toCreate = new Map<string, { budgetCostCenterId: string; accountCode: string; accountName: string }>();

  for (const raw of rawEntries) {
    const sheet = sheets.get(raw.costCenterId);
    if (!sheet) {
      return fail(422, "budget.sheetNotInBudget");
    }

    const amount = parseAmount(raw.amount);
    // Whole öre. `parseAmount` rounds what was typed, but a caller may hand in
    // a number directly, that path takes it as öre already, and the column is
    // an integer, so a fractional one would reach Postgres and come back a 500
    // rather than a message anybody can act on.
    if (!Number.isInteger(amount)) {
      return fail(422, "budget.amountsNotNumbers");
    }

    const code = raw.accountCode;
    const existing = sheet.accounts.find((a) => a.accountCode === code);

    // The result unit is derived from the cost-centre code on every read
    // (lib/server/result-units.ts), exactly as everywhere else, so a prefix reassigned
    // tomorrow regroups this budget too.
    const resultUnit = sheet.costCenter ? resultUnitNameForCode(sheet.costCenter.code, prefixes) : null;
    const withResultUnit = { ...sheet, costCenter: sheet.costCenter ? { resultUnit } : null };

    let accountId: string;
    let kindOfAccount: "INCOME" | "COST";
    if (existing) {
      accountId = existing.id;
      kindOfAccount = effectiveKind(existing.accountCode);
    } else {
      // A code the sheet doesn't budget for. It still has to be a real account,
      // the same rule the ordinary "+ nytt konto" goes through.
      const check = await resolveBudgetAccount(code);
      if (!check.ok) return fail(422, check.error, { values: check.values });
      accountId = `new:${sheet.id}:${check.code}`; // stands in until it exists; see below
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
  // The code is the full path under `errors`, because that is what the client
  // resolves it against (lib/ui/api-error.ts prefixes `errors.`). It used to be
  // `changeError.<code>`, which resolved to nothing and printed the code at the
  // reader. Same keys the sheet reads while composing the change: one string,
  // two readers, whichever language each of them is in.
  if (!check.ok) return fail(422, `budget.changeError.${check.error}`, { values: check.values });

  const change = await prisma.$transaction(async (tx) => {
    // Accounts the change brings into existence, created first so their entries
    // have something to point at.
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

    // Running number within the budget. Taken inside the transaction, and the
    // unique [budgetId, seq] is what makes two changes recorded at once fail
    // rather than share a number.
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
