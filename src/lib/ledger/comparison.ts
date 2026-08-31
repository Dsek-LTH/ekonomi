// Comparison columns for the Utfall reports: the same period a year earlier, or
// the year's adopted budget.
//
// Both return raw öre net (debit − credit) keyed `${account}|${costCenterCode}`,
// the shape lib/ledger/report expects. It applies the display orientation.
import { prisma } from "@/lib/server/db";
import { effectiveKind, sheetKey } from "@/lib/budget";
import { evaluate, type AdjustmentInput, type LineItemInput, type VariableInput } from "@/lib/budget/eval";
import { adjustmentsByAccount } from "@/lib/budget/changes";

export type ComparisonMode = "NONE" | "PRIOR" | "BUDGET";

// The financial year immediately before `financialYear`, or null when it isn't
// in the mirror (nothing to compare against).
async function priorFinancialYear(financialYear: number) {
  const current = await prisma.fortnoxFinancialYear.findUnique({ where: { id: financialYear } });
  if (!current) return null;
  return prisma.fortnoxFinancialYear.findFirst({
    where: { toDate: { lt: current.fromDate } },
    orderBy: { toDate: "desc" },
  });
}

// The same span one financial year earlier. Offsets are taken in whole months
// from each year's own start, so a period keeps its position even if the two
// years differ in length.
export async function priorYearComparison(
  financialYear: number,
  from: Date,
  to: Date,
  yearStart: Date,
): Promise<Map<string, number> | null> {
  const prior = await priorFinancialYear(financialYear);
  if (!prior) return null;

  const shift = (d: Date) => {
    const months =
      (d.getUTCFullYear() - yearStart.getUTCFullYear()) * 12 +
      (d.getUTCMonth() - yearStart.getUTCMonth());
    const start = new Date(prior.fromDate);
    return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + months, 1));
  };
  const priorFrom = shift(from);
  const priorTo = new Date(shift(to));
  // Through the end of the offset month.
  priorTo.setUTCMonth(priorTo.getUTCMonth() + 1);
  priorTo.setUTCDate(0);

  const grouped = await prisma.ledgerRow.groupBy({
    by: ["account", "costCenterCode"],
    // The row's own year and date. See LedgerRow in schema.prisma. The prior
    // year's comparison is the same shape of question as the period itself, and
    // reaches the same index.
    where: {
      financialYear: prior.id,
      date: { gte: priorFrom, lte: priorTo > prior.toDate ? prior.toDate : priorTo },
    },
    _sum: { debit: true, credit: true },
  });

  const out = new Map<string, number>();
  for (const g of grouped) {
    out.set(
      `${g.account}|${g.costCenterCode ?? ""}`,
      (g._sum.debit ?? 0) - (g._sum.credit ?? 0),
    );
  }
  return out;
}

export interface BudgetOption {
  id: string;
  year: number;
  name: string;
  adoptedAt: string | null; // YYYY-MM-DD, or null while it is a draft
  locked: boolean; // sealed, so almost always the adopted one
}

// Every budget there is: what the report offers as "which budget are we
// comparing against".
//
// Not only the ones for the year being reported on: what a year's outcome is
// held against is a question, not a fact about the year. Against what was
// adopted for it, usually; but against 2023's, to see how far the section has
// moved, is as reasonable a thing to ask. Budgets carry their own year and
// nothing ties them to a period, so nothing here has to arrange it. The label
// leads with the year so the choice is never ambiguous on screen.
export async function budgetOptions(): Promise<BudgetOption[]> {
  const budgets = await prisma.budget.findMany({
    // Newest year first; within a year, in the order the section decided them.
    // see getBudgetSummaries, which orders by the same rule for the same reason.
    orderBy: [{ year: "desc" }, { adoptedAt: "asc" }, { createdAt: "asc" }],
    select: { id: true, year: true, name: true, adoptedAt: true, lockedAt: true },
  });
  return budgets.map((b) => ({
    id: b.id,
    year: b.year,
    name: b.name,
    adoptedAt: b.adoptedAt ? b.adoptedAt.toISOString().slice(0, 10) : null,
    locked: b.lockedAt !== null,
  }));
}

// Which budget a comparison should actually use. Any existing budget is honoured
// Picking one of another year is the point, and the picker names its year.
//
// With nothing asked for, the default is this year's own: the locked one, since
// sealing a budget is what a section does to the one it adopted, and failing
// that the most recent. A year with no budget of its own defaults to none rather
// than reaching for a stranger's.
export async function resolveBudget(
  calendarYear: number,
  requested?: string | null,
): Promise<string | null> {
  const budgets = await budgetOptions();
  if (requested && budgets.some((b) => b.id === requested)) return requested;
  const own = budgets.filter((b) => b.year === calendarYear);
  if (own.length === 0) return null;
  // Failing a locked one, the last of the year, which now means the last one
  // adopted rather than the last one typed in, since budgetOptions orders by
  // `adoptedAt` first. A budget imported today from an old workbook no longer
  // outranks the revision the section actually passed in the spring.
  return own.find((b) => b.locked)?.id ?? own[own.length - 1].id;
}

// One budget, per account and cost centre.
//
// Budget amounts are expression strings, so this evaluates the whole budget.
// Values are stored as positive magnitudes oriented by account kind, so they're
// converted back to a debit-minus-credit net here.
export async function budgetComparison(
  budgetId: string,
): Promise<Map<string, number> | null> {
  const budget = await prisma.budget.findUnique({
    where: { id: budgetId },
    include: {
      variables: true,
      // Redaktionella ändringar are part of the budget the outcome is held
      // against: what the report should show is the figure in force, not the one
      // adopted in the autumn. See BudgetChange in schema.prisma.
      changes: { include: { entries: true } },
      costCenters: {
        include: { costCenter: true, accounts: { include: { lineItems: true } } },
      },
    },
  });
  if (!budget) return null;

  const varInputs: VariableInput[] = budget.variables.map((v) => ({
    name: v.name,
    expression: v.expression,
  }));
  const liInputs: LineItemInput[] = budget.costCenters.flatMap((cc) =>
    cc.accounts.flatMap((acct) =>
      acct.lineItems.map((li) => ({
        id: li.id,
        accountKey: `${sheetKey(cc)}:${acct.accountCode}`,
        expression: li.expression,
        values: (li.values ?? {}) as Record<string, string>,
      })),
    ),
  );
  const netByAccount = adjustmentsByAccount(budget.changes);
  const adjustments: AdjustmentInput[] = budget.costCenters.flatMap((cc) =>
    cc.accounts.flatMap((acct) => {
      const amount = netByAccount.get(acct.id);
      return amount === undefined || amount === 0
        ? []
        : [{ accountKey: `${sheetKey(cc)}:${acct.accountCode}`, amount }];
    }),
  );

  const knownAccounts = budget.costCenters.flatMap((cc) =>
    cc.accounts.map((acct) => `${sheetKey(cc)}:${acct.accountCode}`),
  );

  const { accounts } = evaluate(varInputs, liInputs, [], adjustments, knownAccounts);

  const out = new Map<string, number>();
  for (const cc of budget.costCenters) {
    // A sheet not linked to a cost centre has nothing in the ledger to compare
    // against. It is budgeted for one that hasn't been decided yet.
    if (!cc.costCenter) continue;
    for (const acct of cc.accounts) {
      // Already öre. The evaluator reports money in the same unit the ledger
      // stores it in, so there is nothing to convert here any more. This used
      // to be `Math.round(sek * 100)`, the budget side crossing into the
      // ledger's units at the point of comparison.
      const ore = accounts.get(`${cc.costCenter.code}:${acct.accountCode}`);
      if (ore == null) continue;
      // Income is a credit, cost a debit. The report re-orients from there.
      const kind = effectiveKind(acct.accountCode, acct.kindOverride);
      const net = ore * (kind === "INCOME" ? -1 : 1);
      const key = `${acct.accountCode}|${cc.costCenter.code}`;
      out.set(key, (out.get(key) ?? 0) + net);
    }
  }
  return out;
}
