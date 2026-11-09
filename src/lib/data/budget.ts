// One budget loaded and evaluated, shared by the budget page and GET /api/budgets/[id] so both agree on shape.
import "server-only";

import { prisma } from "@/lib/server/db";
import { resultUnitNameForCode, getPrefixes } from "@/lib/server/result-units";
import { evaluate } from "@/lib/budget/eval";
import { evaluatorInputs } from "@/lib/budget/inputs";
import { toEvaluated, type BudgetPayload, type EvaluatedBudgetPayload } from "@/lib/budget/payload";
import { EXTRA_COLUMN_KEYS } from "@/lib/budget/grid";
import { effectiveKind } from "@/lib/budget";
import type { CompareSheet } from "@/lib/budget/compare";
import { financialYearIdForCalendarYear, getActualsByAccountCostCenter } from "@/lib/ledger";
import { isoDay } from "@/lib/domain/date";

export interface BudgetSummary {
  id: string;
  year: number;
  name: string;
  adoptedAt: string | null;
  createdAt: string;
  lockedAt: string | null;
}

/** Every budget, shallow and flat (same-year budgets are siblings). Shared by the list page and GET /api/budgets. */
export async function getBudgetSummaries(): Promise<BudgetSummary[]> {
  const budgets = await prisma.budget.findMany({
    // Newest year first, then `adoptedAt` (the section's chronology; `createdAt` is wrong for imports).
    // Nulls sort last, so drafts come after decided budgets.
    orderBy: [{ year: "desc" }, { adoptedAt: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      year: true,
      name: true,
      adoptedAt: true,
      createdAt: true,
      lockedAt: true,
    },
  });
  return budgets.map((b) => ({
    id: b.id,
    year: b.year,
    name: b.name,
    // Date-only: slicing the ISO string keeps the stored day instead of a timestamp the client would re-zone.
    adoptedAt: b.adoptedAt ? isoDay(b.adoptedAt) : null,
    createdAt: b.createdAt.toISOString(),
    lockedAt: b.lockedAt?.toISOString() ?? null,
  }));
}

interface EvaluatedBudgetOptions {
  /** The year's outcome from the ledger. Costly, and editing a budget cannot change it, so the re-fetch after a write omits it. */
  actuals?: boolean;
  /** The figures every formula resolves to. The re-fetch after a write omits them (the larger half of the response). */
  evaluated?: boolean;
}

/** The evaluated budget, or null for no such id. Overloaded on `evaluated` so callers that kept the figures get a type with them. */
export async function getEvaluatedBudget(
  id: string,
  options?: EvaluatedBudgetOptions & { evaluated?: true },
): Promise<EvaluatedBudgetPayload | null>;
export async function getEvaluatedBudget(
  id: string,
  options: EvaluatedBudgetOptions,
): Promise<BudgetPayload | null>;
export async function getEvaluatedBudget(
  id: string,
  { actuals: withActuals = true, evaluated: withEvaluated = true }: EvaluatedBudgetOptions = {},
): Promise<BudgetPayload | null> {
  const budget = await prisma.budget.findUnique({
    where: { id },
    include: {
      createdBy: { select: { name: true } },
      lockedBy: { select: { name: true } },
      variables: { orderBy: { sortOrder: "asc" } },
      // Oldest first so running numbers come out in order. Revoked ones come along (struck through, not hidden).
      changes: {
        orderBy: { seq: "asc" },
        include: {
          createdBy: { select: { name: true } },
          revokedBy: { select: { name: true } },
          entries: true,
        },
      },
      costCenters: {
        orderBy: { sortOrder: "asc" },
        include: {
          costCenter: true,
          accounts: {
            // By account number, the order of a chart of accounts (BAS codes are four digits, so string sort is numeric).
            orderBy: { accountCode: "asc" },
            include: {
              lineItems: { orderBy: { sortOrder: "asc" } },
              comments: {
                orderBy: { createdAt: "asc" },
                include: { author: { select: { name: true, id: true } } },
              },
            },
          },
        },
      },
    },
  });

  if (!budget) return null;

  // A cost centre's result unit is derived from its code on every read (lib/server/result-units.ts), never stored.
  // Unlinked cost centres have none; the client groups them.
  const prefixes = await getPrefixes();

  // The evaluator's inputs, built by lib/budget/inputs.ts, which the browser also uses after a cell edit.
  const inputs = evaluatorInputs(budget);
  const figures = withEvaluated
    ? evaluate(
        inputs.variables,
        inputs.lineItems,
        [...EXTRA_COLUMN_KEYS],
        inputs.adjustments,
        inputs.knownAccounts,
      )
    : null;

  // Left out rather than sent empty: `actuals: []` would overwrite the client's copy with "none".
  const outcome = withActuals
    ? {
        actuals: await actualSheets(budget.year, budget.costCenters),
        actualsSynced: (await financialYearIdForCalendarYear(budget.year)) != null,
        actualsYear: budget.year,
      }
    : {};

  // Built field by field so it is typed and createdById/updatedAt and friends stay off the wire.
  // Dates are ISO strings so the page's object and the client re-fetch's JSON share one shape.
  return {
    id: budget.id,
    name: budget.name,
    year: budget.year,
    // Date-only, not an instant: midnight UTC read west of it in a browser is the day before.
    adoptedAt: budget.adoptedAt ? isoDay(budget.adoptedAt) : null,
    createdBy: { name: budget.createdBy.name },
    lockedAt: budget.lockedAt?.toISOString() ?? null,
    lockedBy: budget.lockedBy ? { name: budget.lockedBy.name } : null,
    variables: budget.variables.map((v) => ({
      id: v.id,
      name: v.name,
      expression: v.expression,
      sortOrder: v.sortOrder,
    })),
    costCenters: budget.costCenters.map((cc) => ({
      id: cc.id,
      sortOrder: cc.sortOrder,
      label: cc.label,
      costCenter: cc.costCenter
        ? {
            id: cc.costCenter.id,
            code: cc.costCenter.code,
            name: cc.costCenter.name,
            shortName: cc.costCenter.shortName,
            resultUnit: resultUnitNameForCode(cc.costCenter.code, prefixes),
          }
        : null,
      accounts: cc.accounts.map((acct) => ({
        id: acct.id,
        accountCode: acct.accountCode,
        accountName: acct.accountName,
        lineItems: acct.lineItems.map((li) => ({
          id: li.id,
          description: li.description,
          expression: li.expression,
          sortOrder: li.sortOrder,
          values: (li.values ?? {}) as Record<string, string>,
          quantity: li.quantity,
          unitPrice: li.unitPrice,
        })),
        comments: acct.comments.map((c) => ({
          id: c.id,
          body: c.body,
          createdAt: c.createdAt.toISOString(),
          author: { id: c.author.id, name: c.author.name },
        })),
      })),
    })),
    changes: budget.changes.map((ch) => ({
      id: ch.id,
      seq: ch.seq,
      kind: ch.kind,
      reason: ch.reason,
      createdAt: ch.createdAt.toISOString(),
      createdBy: { name: ch.createdBy.name },
      revokedAt: ch.revokedAt?.toISOString() ?? null,
      revokedBy: ch.revokedBy ? { name: ch.revokedBy.name } : null,
      entries: ch.entries.map((e) => ({
        id: e.id,
        accountId: e.accountId,
        amount: e.amount,
      })),
    })),
    ...(figures ? { evaluated: toEvaluated(figures) } : {}),
    ...outcome,
  };
}

// The year's actual outcome from the Fortnox ledger as a side of a comparison (lib/budget/compare.ts).
// Carries everything the ledger has, including unbudgeted spend. Income = credit-debit, cost =
// debit-credit, kind taken from the budget where it has one. Left out: postings with no cost centre,
// and accounts outside the result range 3-8.
async function actualSheets(
  year: number,
  budgeted: {
    costCenter: { code: string } | null;
    accounts: { accountCode: string }[];
  }[],
): Promise<CompareSheet[]> {
  const raw = await getActualsByAccountCostCenter(year);
  if (raw.size === 0) return [];

  const budgetKind = new Map<string, "INCOME" | "COST">();
  for (const cc of budgeted) {
    if (!cc.costCenter) continue;
    for (const a of cc.accounts) {
      budgetKind.set(`${cc.costCenter.code}:${a.accountCode}`, effectiveKind(a.accountCode));
    }
  }

  const [costCenters, chart, prefixes] = await Promise.all([
    prisma.costCenter.findMany({ select: { code: true, name: true, shortName: true } }),
    prisma.account.findMany({ select: { number: true, name: true } }),
    getPrefixes(),
  ]);
  const ccByCode = new Map(costCenters.map((c) => [c.code, c]));
  const acctName = new Map(chart.map((a) => [a.number, a.name]));

  const sheets = new Map<string, CompareSheet>();
  for (const [key, sums] of raw) {
    const [code, accountCode] = key.split("|");
    if (!code || !/^[3-8]/.test(accountCode)) continue;

    let sheet = sheets.get(code);
    if (!sheet) {
      // A linked sheet's compareKey is its cost-centre code, which lines it up with the budget.
      sheet = {
        key: code,
        name: ccByCode.get(code)?.name ?? code,
        shortName: ccByCode.get(code)?.shortName ?? null,
        resultUnit: resultUnitNameForCode(code, prefixes),
        accounts: [],
      };
      sheets.set(code, sheet);
    }
    const kind = budgetKind.get(`${code}:${accountCode}`) ?? effectiveKind(accountCode);
    const net = kind === "INCOME" ? sums.credit - sums.debit : sums.debit - sums.credit;
    sheet.accounts.push({
      code: accountCode,
      name: acctName.get(accountCode) ?? accountCode,
      kind,
      // Öre, as the ledger stores it.
      total: net,
      lines: [], // the ledger has no line items, only account totals
    });
  }

  for (const sheet of sheets.values()) sheet.accounts.sort((a, b) => a.code.localeCompare(b.code));
  return [...sheets.values()];
}
