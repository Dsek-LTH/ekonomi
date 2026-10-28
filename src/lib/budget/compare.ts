// Holding budgets up against each other.
//
// Budgets are independent (see Budget in schema.prisma). No budget knows that
// another exists, and none of them shares a row, a sheet or an id. What makes
// them comparable is that their contents mean the same thing everywhere: cost
// centre SEX02 is SEX02 in every year, account 4010 is account 4010, and a row
// called "Tröjor" is the same row called "Tröjor". So the join is on what things
// are called, never on what they are linked to.
//
// It is an outer join at every level: a sheet, an account or a row that only one
// side has is kept, with nothing on the other side. Dropping it would quietly
// answer "what changed?" with "nothing" in exactly the case where the answer is
// "all of it", a cost centre that was dropped, an account that is new this year.
//
// Any number of sides can be joined at once, so the same code serves the two
// columns in the budget view and the n columns of /budget/compare.
import { effectiveKind, sheetKey, sheetName, type AccountKind } from "@/lib/budget";

/** One row, with its figure on this side. */
interface CompareLine {
  key: string; // what it is matched on, see lineKeys
  description: string;
  value: number | undefined; // öre
}

export interface CompareAccount {
  code: string;
  name: string;
  kind: AccountKind;
  total: number | undefined; // öre
  lines: CompareLine[];
}

export interface CompareSheet {
  key: string; // what it is matched on, see compareKey
  name: string;
  /** The cost centre's name under its result unit's heading, if one is set. */
  shortName?: string | null;
  resultUnit: string | null;
  accounts: CompareAccount[];
}

/** One side of a comparison: a budget, or a year's outcome from the ledger. */
export interface Snapshot {
  id: string;
  label: string; // the column heading, e.g. "2025 - Ursprunglig" or "Utfall 2026"
  sheets: CompareSheet[];
  /** Variables are not money. See the units note in lib/budget/eval.ts. */
  vars: Record<string, number>;
}

// Names are typed by hand in two different budgets, so they are compared
// forgivingly: case and runs of whitespace never distinguish two rows.
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * What a sheet is matched on across budgets.
 *
 * A linked sheet is its cost-centre code, the one thing that means the same in
 * every budget of every year. A detached sheet (schema.prisma: BudgetCostCenter)
 * has no code, so it is matched on its label: copy a budget and its detached
 * sheets keep their names, which is the only reason to think two of them are the
 * same sheet. An unnamed one falls back to its own id and so matches nothing,
 * which is the honest answer. There is nothing to recognise it by.
 *
 * Note this is NOT `sheetKey` from lib/budget: that one keys the evaluator, and
 * has to keep two detached sheets apart *within* one budget even when they are
 * named alike. Here the point is the opposite one.
 */
export function compareKey(cc: {
  id: string;
  label?: string | null;
  costCenter?: { code: string } | null;
}): string {
  if (cc.costCenter) return cc.costCenter.code;
  const label = cc.label?.trim();
  return label ? `@${norm(label)}` : `#${cc.id}`;
}

/**
 * What each row of an account is matched on: its description, and, when an
 * account holds several rows with the same description, which of them it is.
 * Takes the whole account at once, since the n-th "Övrigt" can only be known in
 * the context of the rest.
 */
export function lineKeys(lines: { description: string }[]): string[] {
  const seen = new Map<string, number>();
  return lines.map((li) => {
    const base = norm(li.description);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n === 0 ? base : `${base}~${n}`;
  });
}

/**
 * How a budget names itself as a column: "2026 - Ursprunglig". Several budgets
 * share a year, so the year alone doesn't identify one, and inside a
 * comparison the year is the first thing you look for, so it leads.
 *
 * Here rather than beside either screen that uses it: the budget view and the
 * compare page must label the same budget the same way, and one of them is a
 * Server Component.
 */
// What a budget is called in a picker: the financial year it is held against,
// then its own name.
//
// Deliberately NOT the day it was adopted, though a budget carries one. A
// year's ordinary budget is passed before that year begins, the 2026 budget at
// a möte in late 2025, so leading with the adoption date would file it on
// screen under the wrong year, and the year is the half that decides which
// ledger the figures are compared against. The adoption date is shown where it
// answers a different question: the list's own column, and the budget page.
export const budgetLabel = (b: { year: number; name: string }) => `${b.year} - ${b.name}`;

// The shape both the budget view and the compare page already hold: the API
// payload for one budget. Declared structurally so neither has to convert.
interface BudgetLike {
  id: string;
  costCenters: {
    id: string;
    label: string | null;
    costCenter: { code: string; name: string; shortName?: string | null; resultUnit?: string | null } | null;
    accounts: {
      accountCode: string;
      accountName: string;
      lineItems: { id: string; description: string }[];
    }[];
  }[];
  evaluated: { accounts: Record<string, number>; lineItems: Record<string, number>; vars: Record<string, number> };
}

/**
 * One budget as a side of a comparison. Note the two different keys: the
 * evaluator's figures are looked up by `sheetKey` (unique within this budget),
 * while the sheet is matched to the other side by `compareKey` (meaningful
 * across budgets).
 */
export function snapshotOf(budget: BudgetLike, label: string): Snapshot {
  return {
    id: budget.id,
    label,
    vars: budget.evaluated.vars,
    sheets: budget.costCenters.map((cc) => ({
      key: compareKey(cc),
      name: sheetName(cc),
      shortName: cc.costCenter?.shortName ?? null,
      resultUnit: cc.costCenter?.resultUnit ?? null,
      accounts: cc.accounts.map((a) => {
        const keys = lineKeys(a.lineItems);
        return {
          code: a.accountCode,
          name: a.accountName,
          kind: effectiveKind(a.accountCode),
          total: budget.evaluated.accounts[`${sheetKey(cc)}:${a.accountCode}`],
          lines: a.lineItems.map((li, j) => ({
            key: keys[j],
            description: li.description,
            value: budget.evaluated.lineItems[li.id],
          })),
        };
      }),
    })),
  };
}

interface JoinedLine {
  key: string;
  description: string;
  /** One per side, in the order they were joined. `undefined` = that side has no such row. */
  values: (number | undefined)[];
}

export interface JoinedAccount {
  code: string;
  name: string;
  kind: AccountKind;
  totals: (number | undefined)[];
  lines: JoinedLine[];
}

export interface JoinedSheet {
  key: string;
  name: string;
  shortName: string | null;
  resultUnit: string | null;
  accounts: JoinedAccount[];
  /** Whether each side has this sheet at all. A sheet may exist and total zero. */
  present: boolean[];
}

export interface Joined {
  sheets: JoinedSheet[];
  vars: { name: string; values: (number | undefined)[] }[];
}

/**
 * Full outer join of any number of sides.
 *
 * Order follows the first side that mentions something: the budget you are
 * looking at keeps its own arrangement, and whatever only the others have is
 * appended where it belongs. Labels (a sheet's name, an account's name) come
 * from the first side that has it, so a renamed account reads under the name the
 * budget in front of you gives it.
 */
export function joinSnapshots(snapshots: Snapshot[]): Joined {
  const n = snapshots.length;
  const blank = <T>() => Array.from({ length: n }, () => undefined as T | undefined);

  const sheets = new Map<string, JoinedSheet>();
  const accountsOf = new Map<string, Map<string, JoinedAccount>>();
  const linesOf = new Map<string, Map<string, JoinedLine>>();

  snapshots.forEach((snap, i) => {
    for (const sheet of snap.sheets) {
      let js = sheets.get(sheet.key);
      if (!js) {
        js = {
          key: sheet.key, name: sheet.name, shortName: sheet.shortName ?? null, resultUnit: sheet.resultUnit,
          accounts: [], present: Array.from({ length: n }, () => false),
        };
        sheets.set(sheet.key, js);
        accountsOf.set(sheet.key, new Map());
      }
      js.present[i] = true;
      js.resultUnit ??= sheet.resultUnit;
      js.shortName ??= sheet.shortName ?? null;

      const accounts = accountsOf.get(sheet.key)!;
      for (const acct of sheet.accounts) {
        let ja = accounts.get(acct.code);
        if (!ja) {
          ja = { code: acct.code, name: acct.name, kind: acct.kind, totals: blank<number>(), lines: [] };
          accounts.set(acct.code, ja);
          js.accounts.push(ja);
          linesOf.set(`${sheet.key}:${acct.code}`, new Map());
        }
        ja.totals[i] = acct.total;

        const lines = linesOf.get(`${sheet.key}:${acct.code}`)!;
        for (const line of acct.lines) {
          let jl = lines.get(line.key);
          if (!jl) {
            jl = { key: line.key, description: line.description, values: blank<number>() };
            lines.set(line.key, jl);
            ja.lines.push(jl);
          }
          jl.values[i] = line.value;
        }
      }
    }
  });

  // Variables are a flat namespace, joined on the name alone.
  const vars = new Map<string, { name: string; values: (number | undefined)[] }>();
  snapshots.forEach((snap, i) => {
    for (const [name, value] of Object.entries(snap.vars)) {
      let row = vars.get(name);
      if (!row) { row = { name, values: blank<number>() }; vars.set(name, row); }
      row.values[i] = value;
    }
  });

  return { sheets: [...sheets.values()], vars: [...vars.values()] };
}

export interface Totals { income: number; cost: number; result: number }

/** One side's income/cost/result for a joined sheet. Missing accounts count 0. */
export function sheetTotals(sheet: JoinedSheet, side: number): Totals {
  let income = 0, cost = 0;
  for (const a of sheet.accounts) {
    const v = a.totals[side] ?? 0;
    if (a.kind === "INCOME") income += v; else cost += v;
  }
  return { income, cost, result: income - cost };
}

export const ZERO_TOTALS: Totals = { income: 0, cost: 0, result: 0 };
