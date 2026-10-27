// One budget, loaded and evaluated: the sheets, the variables, the editorial
// history, every figure the formula engine resolves, and the year's actual
// outcome beside it.
//
// Two callers want exactly this: the budget page, which server-renders the
// first copy, and GET /api/budgets/[id], which the page's client re-fetches
// after each write. They must agree down to the shape: the client seeds its
// state from one and replaces it with the other, so the loading lives here
// and neither owns it.
import "server-only";

import { prisma } from "@/lib/server/db";
import { resultUnitNameForCode, getPrefixes } from "@/lib/server/result-units";
import { evaluate } from "@/lib/budget/eval";
import { evaluatorInputs } from "@/lib/budget/inputs";
import {
  toEvaluated,
  type BudgetPayload,
  type EvaluatedBudgetPayload,
} from "@/lib/budget/payload";
import { EXTRA_COLUMN_KEYS } from "@/lib/budget/grid";
import { effectiveKind } from "@/lib/budget";
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
  /** The day the meeting adopted it, YYYY-MM-DD, or null while it is a draft. */
  adoptedAt: string | null;
  createdAt: string;
  lockedAt: string | null;
}

/**
 * Every budget, shallow. A flat list: budgets of the same year are siblings,
 * not a group, so nothing here nests.
 *
 * Shared by the list page (which server-renders it) and GET /api/budgets (which
 * the compare view fetches for its picker), the same reason
 * `getEvaluatedBudget` is shared, and the same rule: one loader, so the two can
 * never disagree about what a budget row is.
 */
export async function getBudgetSummaries(): Promise<BudgetSummary[]> {
  const budgets = await prisma.budget.findMany({
    // Newest year first; within a year, in the order the section decided them,
    // the ordinary budget before any revision adopted after it.
    //
    // `adoptedAt` leads because it is the section's own chronology, and
    // `createdAt` only records when a row was typed: a budget imported from an
    // old workbook was created today and adopted years ago. Nulls sort last
    // under Postgres's default for ascending order, which is what we want. An
    // unadopted draft belongs after everything that was actually decided.
    orderBy: [{ year: "desc" }, { adoptedAt: "asc" }, { createdAt: "asc" }],
    select: { id: true, year: true, name: true, adoptedAt: true, createdAt: true, lockedAt: true },
  });
  return budgets.map((b) => ({
    id: b.id,
    year: b.year,
    name: b.name,
    // Date-only: the column is a DATE, and slicing the ISO string keeps it the
    // day it was stored as rather than a timestamp the client would re-zone.
    adoptedAt: b.adoptedAt ? b.adoptedAt.toISOString().slice(0, 10) : null,
    createdAt: b.createdAt.toISOString(),
    lockedAt: b.lockedAt?.toISOString() ?? null,
  }));
}

/** What a caller can leave out of the payload, and why it would want to. */
interface EvaluatedBudgetOptions {
  /**
   * The year's outcome from the ledger. Costly (a group-by over every posting
   * of the financial year, plus the chart and the cost-centre list to name them)
   * and editing a budget cannot change any of it. The page asks for it; the
   * re-fetch after a write does not, and the client keeps the copy it has.
   */
  actuals?: boolean;
  /**
   * The figures every formula resolves to. Left out, the payload is the budget's
   * rows and nothing derived from them, and the caller works the values out
   * itself, which the budget page does anyway on every cell it commits, with
   * this same `evaluate`. The page's first paint wants them; the re-fetch after
   * a write does not, and they are the larger half of that response.
   */
  evaluated?: boolean;
}

/**
 * The evaluated budget, or null when there is no budget with that id.
 *
 * Overloaded on `evaluated`, so a caller that did not turn the figures off gets
 * a type that has them. Otherwise every ordinary caller (both of them) would
 * have to test for a field it knows is there, and the budget page used to
 * assert its way past exactly that with `as unknown as Budget`.
 */
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
      // The editorial history, oldest first. It reads as a chronicle, and the
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
            // By account number, which is the order a chart of accounts is
            // read in and the one every printed budget uses. It was
            // `sortOrder`, and since accounts are not draggable (only line
            // items are) that amounted to "the order somebody happened to add
            // them", so 3010 could sit under 5800 for no reason a reader could
            // see. BAS codes are four digits throughout, so the string sort is
            // the numeric one.
            orderBy: { accountCode: "asc" },
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
  // read (lib/server/result-units.ts), never stored, so re-assigning a prefix regroups
  // every budget that mentions it, including ones drafted before the result unit
  // existed. Cost centres that aren't linked to one yet have no code and no
  // result unit; the client groups those on their own.
  const prefixes = await getPrefixes();

  // The evaluator's inputs, built the one way (lib/budget/inputs.ts). The
  // browser builds them from the same function after a cell edit, which is what
  // stops the two from ever answering differently.
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

  // Built field by field rather than spread from the row and pushed through
  // `JSON.parse(JSON.stringify(...))`.
  //
  // The round trip was doing two jobs: turning Dates into strings, and erasing
  // the type, so what came out was `Record<string, unknown>` and the page
  // bridged it to the client with `as unknown as Budget`. Nothing checked that
  // the two agreed. Writing the payload out means the compiler does, it means
  // the columns nobody reads (createdById, updatedAt, the changes' foreign
  // keys) stop crossing the wire, and it means one pass over the tree instead
  // of three.
  //
  // Dates are ISO strings here for the reason the round trip made them so: the
  // page hands the client this object and the client's own re-fetch hands it
  // the JSON of the same object, and seeding state from one then replacing it
  // with the other must not produce two shapes.
  return {
    id: budget.id,
    name: budget.name,
    year: budget.year,
    // Date-only, and deliberately not an instant. `toISOString()` on a DATE
    // gives "…T00:00:00.000Z", and midnight UTC read in a browser west of it is
    // the day before, which for the day a meeting sat is simply the wrong
    // answer. So the day itself travels and no zone gets a say in it.
    adoptedAt: budget.adoptedAt ? budget.adoptedAt.toISOString().slice(0, 10) : null,
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
      entries: ch.entries.map((e) => ({ id: e.id, accountId: e.accountId, amount: e.amount })),
    })),
    ...(figures ? { evaluated: toEvaluated(figures) } : {}),
    ...outcome,
  };
}

// The year's actual outcome from the Fortnox ledger, shaped as a side of a
// comparison (lib/budget/compare.ts) so it joins against a budget exactly like
// another budget does.
//
// It carries everything the ledger has, not only what this budget happens to
// budget for: a cost centre or an account that was spent on without being
// budgeted is precisely what the comparison is there to show. Figures are
// oriented by account kind (income = credit−debit, cost = debit−credit), taking
// the kind from the budget wherever it has an opinion, so an account
// reclassified by hand keeps its sign.
//
// Two things are deliberately left out: postings with no cost centre (they
// belong to no sheet, and are mostly balance-sheet movements), and accounts
// outside the result range 3-8, which no budget holds either way.
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
    const kind = budgetKind.get(`${code}:${accountCode}`) ?? effectiveKind(accountCode);
    const net = kind === "INCOME" ? sums.credit - sums.debit : sums.debit - sums.credit;
    sheet.accounts.push({
      code: accountCode,
      name: acctName.get(accountCode) ?? accountCode,
      kind,
      // Öre, as the ledger stores it. This used to divide by 100 because the
      // budget side was kronor and the two had to meet somewhere; they meet in
      // öre now, so the conversion is gone rather than moved.
      total: net,
      lines: [], // the ledger has no line items, only account totals
    });
  }

  for (const sheet of sheets.values()) sheet.accounts.sort((a, b) => a.code.localeCompare(b.code));
  return [...sheets.values()];
}
