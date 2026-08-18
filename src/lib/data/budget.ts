// One budget, loaded and evaluated: the sheets, the variables, the editorial
// history, every figure the formula engine resolves, and the year's actual
// outcome beside it.
//
// Two callers want exactly this: the budget page, which server-renders the
// first copy, and GET /api/budgets/[id], which the page's client re-fetches
// after each write. They must agree down to the shape — the client seeds its
// state from one and replaces it with the other — so the loading lives here
// and neither owns it.
import "server-only";

import { prisma } from "@/lib/server/db";
import { resultUnitNameForCode, getPrefixes } from "@/lib/server/result-units";
import { evaluate } from "@/lib/budget/eval";
import type { AdjustmentInput, LineItemInput, VariableInput } from "@/lib/budget/eval";
import { adjustmentsByAccount } from "@/lib/budget/changes";
import { EXTRA_COLUMN_KEYS } from "@/lib/budget/grid";
import { effectiveKind, inferKind, sheetKey } from "@/lib/budget";
import type { CompareSheet } from "@/lib/budget/compare";
import {
  financialYearIdForCalendarYear,
  getActualsByAccountCostCenter,
} from "@/lib/ledger";

/** A budget as the list and the compare picker know it: a year and a name. */
export interface BudgetSummary {
  id: string;
  year: number;
  name: string;
  createdAt: string;
  lockedAt: string | null;
}

/**
 * Every budget, shallow. A flat list: budgets of the same year are siblings,
 * not a group, so nothing here nests.
 *
 * Shared by the list page (which server-renders it) and GET /api/budgets (which
 * the compare view fetches for its picker) — the same reason
 * `getEvaluatedBudget` is shared, and the same rule: one loader, so the two can
 * never disagree about what a budget row is.
 */
export async function getBudgetSummaries(): Promise<BudgetSummary[]> {
  const budgets = await prisma.budget.findMany({
    // Newest year first; within a year, in the order they were made — the
    // ordinary budget before any drafted after it.
    orderBy: [{ year: "desc" }, { createdAt: "asc" }],
    select: { id: true, year: true, name: true, createdAt: true, lockedAt: true },
  });
  return budgets.map((b) => ({
    id: b.id,
    year: b.year,
    name: b.name,
    createdAt: b.createdAt.toISOString(),
    lockedAt: b.lockedAt?.toISOString() ?? null,
  }));
}

/**
 * The evaluated budget, exactly as the client receives it — dates as ISO
 * strings, everything plain JSON.
 *
 * The shape is described on the client side (app/(app)/budget/[budgetId]/
 * budget-types.ts), which is where it is consumed; typing it here as well
 * would be two descriptions of one payload, free to drift apart.
 */
export type EvaluatedBudget = Record<string, unknown>;

/** What a caller can leave out of the payload, and why it would want to. */
export interface EvaluatedBudgetOptions {
  /**
   * The year's outcome from the ledger. Costly — a group-by over every posting
   * of the financial year, plus the chart and the cost-centre list to name them
   * — and editing a budget cannot change any of it. The page asks for it; the
   * re-fetch after a write does not, and the client keeps the copy it has.
   */
  actuals?: boolean;
  /**
   * The figures every formula resolves to. Left out, the payload is the budget's
   * rows and nothing derived from them, and the caller works the values out
   * itself — which the budget page does anyway on every cell it commits, with
   * this same `evaluate`. The page's first paint wants them; the re-fetch after
   * a write does not, and they are the larger half of that response.
   */
  evaluated?: boolean;
  /**
   * Whether to hand back plain JSON — dates as strings — rather than the Prisma
   * rows as they came. On for the page, which passes this straight into a client
   * component and must hand it the same shapes the fetch does. Off for the
   * route, where `NextResponse.json` does exactly this on the way out and doing
   * it here as well is a second pass over the whole payload.
   */
  serialize?: boolean;
}

/** The evaluated budget, or null when there is no budget with that id. */
export async function getEvaluatedBudget(
  id: string,
  {
    actuals: withActuals = true,
    evaluated: withEvaluated = true,
    serialize = true,
  }: EvaluatedBudgetOptions = {},
): Promise<EvaluatedBudget | null> {
  const budget = await prisma.budget.findUnique({
    where: { id },
    include: {
      createdBy: { select: { name: true } },
      lockedBy: { select: { name: true } },
      variables: { orderBy: { sortOrder: "asc" } },
      // The editorial history, oldest first — it reads as a chronicle, and the
      // running numbers then come out in order. Revoked ones come along: they
      // are struck through, not hidden.
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
            orderBy: { sortOrder: "asc" },
            include: {
              lineItems: { orderBy: { sortOrder: "asc" } },
              comments: { orderBy: { createdAt: "asc" }, include: { author: { select: { name: true, id: true } } } },
            },
          },
        },
      },
    },
  });

  if (!budget) return null;

  // Which result unit a cost centre belongs to is derived from its code on every
  // read (lib/server/result-units.ts), never stored — so re-assigning a prefix regroups
  // every budget that mentions it, including ones drafted before the result unit
  // existed. Cost centres that aren't linked to one yet have no code and no
  // result unit; the client groups those on their own.
  const prefixes = await getPrefixes();

  const varInputs: VariableInput[] = budget.variables.map((v) => ({ name: v.name, expression: v.expression }));
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

  // Redaktionella ändringar are added on top of the rows they adjust, so every
  // figure downstream — account totals, `account(CC, ACCT)` references, the
  // rambudget, the comparison — is what is actually in force. The sheet shows
  // them as their own rows, which is where the history stays visible.
  const netByAccount = adjustmentsByAccount(budget.changes);
  const adjustments: AdjustmentInput[] = budget.costCenters.flatMap((cc) =>
    cc.accounts.flatMap((acct) => {
      const amount = netByAccount.get(acct.id);
      return amount === undefined || amount === 0
        ? []
        : [{ accountKey: `${sheetKey(cc)}:${acct.accountCode}`, amount }];
    }),
  );

  // Every account the budget holds, rows or no rows: an `account(CC, KONTO)`
  // naming one of these is empty (zero) rather than broken. See `evaluate`.
  const knownAccounts = budget.costCenters.flatMap((cc) =>
    cc.accounts.map((acct) => `${sheetKey(cc)}:${acct.accountCode}`),
  );

  const figures = withEvaluated
    ? evaluate(varInputs, liInputs, [...EXTRA_COLUMN_KEYS], adjustments, knownAccounts)
    : null;

  // Left out entirely rather than sent empty: a caller that didn't ask for the
  // outcome has its own copy, and an `actuals: []` would overwrite it with
  // "there isn't any", which is a different thing and reads as one on screen.
  const outcome = withActuals
    ? {
        actuals: await actualSheets(budget.year, budget.costCenters),
        actualsSynced: (await financialYearIdForCalendarYear(budget.year)) != null,
        actualsYear: budget.year,
      }
    : {};

  const payload = {
    ...budget,
    costCenters: budget.costCenters.map((cc) => ({
      ...cc,
      costCenter: cc.costCenter
        ? { ...cc.costCenter, resultUnit: resultUnitNameForCode(cc.costCenter.code, prefixes) }
        : null,
    })),
    ...(figures
      ? {
          evaluated: {
            vars: Object.fromEntries(figures.vars),
            accounts: Object.fromEntries(figures.accounts),
            lineItems: Object.fromEntries(figures.lineItems),
            cells: Object.fromEntries(figures.cells),
            badLineItems: figures.badLineItems,
            badVariables: figures.badVariables,
            badAccounts: figures.badAccounts,
            errors: figures.errors,
          },
        }
      : {}),
    ...outcome,
  };

  // Through JSON on the way out, which is the point rather than an accident:
  // the page hands the client the same thing the fetch does — dates as ISO
  // strings, not Date objects — so seeding state from one and replacing it with
  // the other cannot produce two different shapes. The route turns this off,
  // because serialising the response is what it is about to do anyway.
  return (serialize ? JSON.parse(JSON.stringify(payload)) : payload) as EvaluatedBudget;
}

// The year's actual outcome from the Fortnox ledger, shaped as a side of a
// comparison (lib/budget/compare.ts) so it joins against a budget exactly like
// another budget does.
//
// It carries everything the ledger has, not only what this budget happens to
// budget for: a cost centre or an account that was spent on without being
// budgeted is precisely what the comparison is there to show. Figures are
// oriented by account kind — income = credit−debit, cost = debit−credit — taking
// the kind from the budget wherever it has an opinion, so an account
// reclassified by hand keeps its sign.
//
// Two things are deliberately left out: postings with no cost centre (they
// belong to no sheet, and are mostly balance-sheet movements), and accounts
// outside the result range 3–8, which no budget holds either way.
async function actualSheets(
  year: number,
  budgeted: {
    costCenter: { code: string } | null;
    accounts: { accountCode: string; kindOverride: "INCOME" | "COST" | null }[];
  }[],
): Promise<CompareSheet[]> {
  const raw = await getActualsByAccountCostCenter(year);
  if (raw.size === 0) return [];

  const budgetKind = new Map<string, "INCOME" | "COST">();
  for (const cc of budgeted) {
    if (!cc.costCenter) continue;
    for (const a of cc.accounts) {
      budgetKind.set(`${cc.costCenter.code}:${a.accountCode}`, effectiveKind(a.accountCode, a.kindOverride));
    }
  }

  const [costCenters, chart, prefixes] = await Promise.all([
    prisma.costCenter.findMany({ select: { code: true, name: true } }),
    prisma.account.findMany({ select: { number: true, name: true } }),
    getPrefixes(),
  ]);
  const ccName = new Map(costCenters.map((c) => [c.code, c.name]));
  const acctName = new Map(chart.map((a) => [a.number, a.name]));

  const sheets = new Map<string, CompareSheet>();
  for (const [key, sums] of raw) {
    const [code, accountCode] = key.split("|");
    if (!code || !/^[3-8]/.test(accountCode)) continue;

    let sheet = sheets.get(code);
    if (!sheet) {
      // A linked sheet's compareKey is its cost-centre code, which is what makes
      // this line up with the budget without either side arranging it.
      sheet = {
        key: code,
        name: ccName.get(code) ?? code,
        resultUnit: resultUnitNameForCode(code, prefixes),
        accounts: [],
      };
      sheets.set(code, sheet);
    }
    const kind = budgetKind.get(`${code}:${accountCode}`) ?? inferKind(accountCode);
    const net = kind === "INCOME" ? sums.credit - sums.debit : sums.debit - sums.credit;
    sheet.accounts.push({
      code: accountCode,
      name: acctName.get(accountCode) ?? accountCode,
      kind,
      // Öre, as the ledger stores it. This used to divide by 100 because the
      // budget side was kronor and the two had to meet somewhere; they meet in
      // öre now, so the conversion is gone rather than moved.
      total: net,
      lines: [], // the ledger has no line items — only account totals
    });
  }

  for (const sheet of sheets.values()) sheet.accounts.sort((a, b) => a.code.localeCompare(b.code));
  return [...sheets.values()];
}
