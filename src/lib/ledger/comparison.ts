// Comparison columns for the Utfall reports (same period a year earlier, or an adopted budget).
// Both return raw öre net (debit - credit) keyed `${account}|${costCenterCode}`, as lib/ledger/report expects.
import { prisma } from "@/lib/server/db";
import { effectiveKind } from "@/lib/budget";
import { evaluate } from "@/lib/budget/eval";
import { evaluatorInputs } from "@/lib/budget/inputs";
import { isoDay } from "@/lib/domain/date";

export type ComparisonMode = "NONE" | "PRIOR" | "BUDGET";

async function priorFinancialYear(financialYear: number) {
  const current = await prisma.fortnoxFinancialYear.findUnique({ where: { id: financialYear } });
  if (!current) return null;
  return prisma.fortnoxFinancialYear.findFirst({
    where: { toDate: { lt: current.fromDate } },
    orderBy: { toDate: "desc" },
  });
}

// The same span one financial year earlier. Offsets are in whole months from each year's own start.
export async function priorYearComparison(
  financialYear: number,
  from: Date,
  to: Date,
  yearStart: Date,
): Promise<Map<string, number> | null> {
  const prior = await priorFinancialYear(financialYear);
  if (!prior) return null;

  // Same day, as many months into the prior year. A month's last day maps to the prior month's last day.
  const shift = (d: Date) => {
    const months =
      (d.getUTCFullYear() - yearStart.getUTCFullYear()) * 12 +
      (d.getUTCMonth() - yearStart.getUTCMonth());
    const start = new Date(prior.fromDate);
    const y = start.getUTCFullYear();
    const m = start.getUTCMonth() + months;
    const lastHere = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    const lastThere = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const day = d.getUTCDate() === lastHere ? lastThere : Math.min(d.getUTCDate(), lastThere);
    return new Date(Date.UTC(y, m, day));
  };
  const priorFrom = shift(from);
  const priorTo = shift(to);

  const grouped = await prisma.ledgerRow.groupBy({
    by: ["account", "costCenterCode"],
    where: {
      financialYear: prior.id,
      date: { gte: priorFrom, lte: priorTo > prior.toDate ? prior.toDate : priorTo },
    },
    _sum: { debit: true, credit: true },
  });

  const out = new Map<string, number>();
  for (const g of grouped) {
    out.set(`${g.account}|${g.costCenterCode ?? ""}`, (g._sum.debit ?? 0) - (g._sum.credit ?? 0));
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

// Every budget there is, labelled with the year first. A year's outcome may be held against any year's budget.
export async function budgetOptions(): Promise<BudgetOption[]> {
  const budgets = await prisma.budget.findMany({
    // Newest year first; within a year, in the order decided (as getBudgetSummaries).
    orderBy: [{ year: "desc" }, { adoptedAt: "asc" }, { createdAt: "asc" }],
    select: { id: true, year: true, name: true, adoptedAt: true, lockedAt: true },
  });
  return budgets.map((b) => ({
    id: b.id,
    year: b.year,
    name: b.name,
    adoptedAt: b.adoptedAt ? isoDay(b.adoptedAt) : null,
    locked: b.lockedAt !== null,
  }));
}

// Which budget a comparison uses. Any existing budget is honoured. By default this year's locked one,
// else the most recent, else none.
export async function resolveBudget(
  calendarYear: number,
  requested?: string | null,
): Promise<string | null> {
  const budgets = await budgetOptions();
  if (requested && budgets.some((b) => b.id === requested)) return requested;
  const own = budgets.filter((b) => b.year === calendarYear);
  if (own.length === 0) return null;
  // Failing a locked one, the last adopted (budgetOptions orders by `adoptedAt` first).
  return own.find((b) => b.locked)?.id ?? own[own.length - 1].id;
}

// One budget per account and cost centre. Amounts are expression strings stored as positive
// magnitudes by account kind, so they are converted back to debit-minus-credit net.
export async function budgetComparison(budgetId: string): Promise<Map<string, number> | null> {
  const budget = await prisma.budget.findUnique({
    where: { id: budgetId },
    include: {
      variables: true,
      // Redaktionella ändringar count: the figure in force (BudgetChange).
      changes: { include: { entries: true } },
      costCenters: {
        include: { costCenter: true, accounts: { include: { lineItems: true } } },
      },
    },
  });
  if (!budget) return null;

  // Same inputs as the budget page, so the figures agree. No extra columns: only account totals are wanted.
  const inputs = evaluatorInputs(budget);
  const { accounts } = evaluate(
    inputs.variables,
    inputs.lineItems,
    [],
    inputs.adjustments,
    inputs.knownAccounts,
  );

  const out = new Map<string, number>();
  for (const cc of budget.costCenters) {
    // A sheet not linked to a cost centre has nothing in the ledger to compare against.
    if (!cc.costCenter) continue;
    for (const acct of cc.accounts) {
      // Already öre.
      const ore = accounts.get(`${cc.costCenter.code}:${acct.accountCode}`);
      if (ore == null) continue;
      // Income is a credit, cost a debit. The report re-orients from there.
      const kind = effectiveKind(acct.accountCode);
      const net = ore * (kind === "INCOME" ? -1 : 1);
      const key = `${acct.accountCode}|${cc.costCenter.code}`;
      out.set(key, (out.get(key) ?? 0) + net);
    }
  }
  return out;
}
