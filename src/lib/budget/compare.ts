// Joins budgets on what things are called (cost centre code, account number, row description), never on links,
// since budgets share no ids. Outer join at every level, so a dropped sheet or new account still shows.
// Any number of sides, serving both the budget view and /budget/compare.
import { effectiveKind, sheetKey, sheetName, type AccountKind } from "@/lib/budget";

/** One row, with its figure on this side. */
interface CompareLine {
  key: string;
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
  key: string;
  name: string;
  shortName?: string | null;
  resultUnit: string | null;
  accounts: CompareAccount[];
}

export interface Snapshot {
  id: string;
  label: string; // the column heading, e.g. "2025 - Ursprunglig" or "Utfall 2026"
  sheets: CompareSheet[];
  /** Variables are not money. See the units note in lib/budget/eval.ts. */
  vars: Record<string, number>;
}

// Names are typed by hand, so case and whitespace runs never distinguish rows.
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Sheet match key: the cost-centre code for a linked sheet, the label for a detached one, else its own id.
 * Not `sheetKey`, which keeps same-named detached sheets apart within one budget.
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

/** Row match key: the description, plus which of several same-described rows it is. */
export function lineKeys(lines: { description: string }[]): string[] {
  const seen = new Map<string, number>();
  return lines.map((li) => {
    const base = norm(li.description);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n === 0 ? base : `${base}~${n}`;
  });
}

// A budget as a column heading or picker label. The year leads (several budgets share one) and is not
// the adoption date, since a year's budget is passed before that year begins.
export const budgetLabel = (b: { year: number; name: string }) => `${b.year} - ${b.name}`;

// The API payload for one budget, declared structurally so neither screen converts.
interface BudgetLike {
  id: string;
  costCenters: {
    id: string;
    label: string | null;
    costCenter: {
      code: string;
      name: string;
      shortName?: string | null;
      resultUnit?: string | null;
    } | null;
    accounts: {
      accountCode: string;
      accountName: string;
      lineItems: { id: string; description: string }[];
    }[];
  }[];
  evaluated: {
    accounts: Record<string, number>;
    lineItems: Record<string, number>;
    vars: Record<string, number>;
  };
}

/** One budget as a side. Figures are looked up by `sheetKey`, the sheet is matched across budgets by `compareKey`. */
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
  present: boolean[];
}

export interface Joined {
  sheets: JoinedSheet[];
  vars: { name: string; values: (number | undefined)[] }[];
}

/** Full outer join of any number of sides. Order and labels follow the first side that has them. */
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
          key: sheet.key,
          name: sheet.name,
          shortName: sheet.shortName ?? null,
          resultUnit: sheet.resultUnit,
          accounts: [],
          present: Array.from({ length: n }, () => false),
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
          ja = {
            code: acct.code,
            name: acct.name,
            kind: acct.kind,
            totals: blank<number>(),
            lines: [],
          };
          accounts.set(acct.code, ja);
          js.accounts.push(ja);
          linesOf.set(`${sheet.key}:${acct.code}`, new Map());
        }
        ja.totals[i] = acct.total;

        const lines = linesOf.get(`${sheet.key}:${acct.code}`)!;
        for (const line of acct.lines) {
          let jl = lines.get(line.key);
          if (!jl) {
            jl = {
              key: line.key,
              description: line.description,
              values: blank<number>(),
            };
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
      if (!row) {
        row = { name, values: blank<number>() };
        vars.set(name, row);
      }
      row.values[i] = value;
    }
  });

  return { sheets: [...sheets.values()], vars: [...vars.values()] };
}

export interface Totals {
  income: number;
  cost: number;
  result: number;
}

/** One side's income/cost/result for a joined sheet. Missing accounts count 0. */
export function sheetTotals(sheet: JoinedSheet, side: number): Totals {
  let income = 0,
    cost = 0;
  for (const a of sheet.accounts) {
    const v = a.totals[side] ?? 0;
    if (a.kind === "INCOME") income += v;
    else cost += v;
  }
  return { income, cost, result: income - cost };
}

export const ZERO_TOTALS: Totals = { income: 0, cost: 0, result: 0 };
