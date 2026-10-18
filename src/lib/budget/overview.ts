// Budget against utfall, per result unit and cost centre. The arithmetic only:
// lib/data/budget-overview.ts fetches the figures and hands them in, so this
// can be tested without a database.
import { effectiveKind, isResultAccount } from "./index";
import { oreToSEK } from "@/lib/domain/money";

/** Budgeted and booked, in SEK, both read positive. */
export interface BudgetFigure {
  budget: number;
  actual: number;
}

export interface OverviewCostCenter {
  /** "" for ledger rows booked on no cost centre. */
  code: string;
  name: string | null;
  income: BudgetFigure;
  cost: BudgetFigure;
}

export interface OverviewUnit {
  /** null for the cost centres no result unit's prefix claims. */
  name: string | null;
  income: BudgetFigure;
  cost: BudgetFigure;
  costCenters: OverviewCostCenter[];
}

const zero = (): BudgetFigure => ({ budget: 0, actual: 0 });

/**
 * Add one account's net (debit - credit, öre) to a figure, on the side its
 * number puts it: income is a credit and reads positive, cost a debit.
 */
function add(
  target: { income: BudgetFigure; cost: BudgetFigure },
  account: string,
  net: number,
  field: keyof BudgetFigure,
) {
  if (effectiveKind(account) === "INCOME") target.income[field] -= net;
  else target.cost[field] += net;
}

/**
 * `planned` is the budget as `budgetComparison` returns it and `booked` the
 * ledger grouped per account and cost centre, both net öre (debit - credit).
 * `unitOf` names the result unit a cost-centre code belongs to.
 */
export function buildOverview(
  planned: Iterable<[string, number]>,
  booked: { account: string; costCenterCode: string | null; debit: number; credit: number }[],
  unitOf: (code: string) => string | null,
  names: ReadonlyMap<string, string>,
): OverviewUnit[] {
  // Summed in öre and converted once at the end, so rounding happens per
  // figure rather than per ledger row.
  const byCode = new Map<string, OverviewCostCenter>();
  const row = (code: string) => {
    let cc = byCode.get(code);
    if (!cc) {
      cc = { code, name: null, income: zero(), cost: zero() };
      byCode.set(code, cc);
    }
    return cc;
  };

  for (const [key, net] of planned) {
    const [account, code] = key.split("|");
    add(row(code), account, net, "budget");
  }
  for (const g of booked) {
    // The balance accounts are what the year leaves behind, not what it
    // earned or spent, and no budget holds them.
    if (!isResultAccount(g.account)) continue;
    add(row(g.costCenterCode ?? ""), g.account, g.debit - g.credit, "actual");
  }

  const units = new Map<string | null, OverviewUnit>();
  for (const cc of byCode.values()) {
    for (const f of [cc.income, cc.cost]) {
      f.budget = oreToSEK(f.budget);
      f.actual = oreToSEK(f.actual);
    }
    // Nothing either way is a cost centre that only ever netted to zero, and a
    // row of zeroes is not worth a line.
    if (![cc.income, cc.cost].some((f) => f.budget || f.actual)) continue;
    cc.name = names.get(cc.code) ?? null;

    const unitName = cc.code ? unitOf(cc.code) : null;
    let unit = units.get(unitName);
    if (!unit) {
      unit = { name: unitName, income: zero(), cost: zero(), costCenters: [] };
      units.set(unitName, unit);
    }
    unit.costCenters.push(cc);
    for (const side of ["income", "cost"] as const) {
      unit[side].budget += cc[side].budget;
      unit[side].actual += cc[side].actual;
    }
  }

  return [...units.values()]
    .map((u) => ({
      ...u,
      // The no-cost-centre bucket last within a unit, then by code.
      costCenters: u.costCenters.sort((a, b) =>
        a.code === "" ? 1 : b.code === "" ? -1 : a.code.localeCompare(b.code, "sv"),
      ),
    }))
    // By name, with what no unit claims at the end.
    .sort((a, b) =>
      a.name === null ? 1 : b.name === null ? -1 : a.name.localeCompare(b.name, "sv"),
    );
}

/**
 * How a cost budget is keeping up with the year. `elapsed` is the share of the
 * year gone, 0 to 1. Null where there is no cost budget to keep up with.
 *
 * AHEAD is spending faster than the year is passing, by more than a tenth of
 * the budget: a little ahead is ordinary (a term starts with its biggest
 * event), and a tag that is always on says nothing.
 */
export type Pace = "OVER" | "AHEAD" | "ON_TRACK";

export function paceOf(cost: BudgetFigure, elapsed: number): Pace | null {
  if (cost.budget <= 0) return null;
  const share = cost.actual / cost.budget;
  if (share > 1) return "OVER";
  if (share > elapsed + 0.1) return "AHEAD";
  return "ON_TRACK";
}

/** Several units' figures added up, for a row of totals over them. */
export function totalOf(units: readonly { income: BudgetFigure; cost: BudgetFigure }[]) {
  const total = { income: zero(), cost: zero() };
  for (const u of units) {
    for (const side of ["income", "cost"] as const) {
      total[side].budget += u[side].budget;
      total[side].actual += u[side].actual;
    }
  }
  return total;
}
