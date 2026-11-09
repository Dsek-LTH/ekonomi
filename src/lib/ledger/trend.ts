// The ledger cut the four ways a chart needs it, all from one query: months, costCenters, stack, sections.
// Amounts are in SEK, oriented as the report orients them: income positive, costs negative.
import { prisma } from "@/lib/server/db";
import { orient, sectionsFor, type BasSection } from "./bas";
import { oreToSEK } from "@/lib/domain/money";
import { NO_CC, costCenterMatcher, costCenterWhere } from "./cost-center-filter";

/** The BAS section that is money coming in. Everything else in a result report is money going out. */
const INCOME_SECTION = "intakter";

export interface TrendMonth {
  /** "YYYY-MM". Every month of the period is here, including empty ones. */
  month: string;
  income: number;
  costs: number; // negative
  result: number; // income + costs
  /** The result summed from the period's first month up to and including this one. */
  cumulative: number;
}

export interface TrendCostCenter {
  /** Null for the rows that carry none. */
  code: string | null;
  name: string | null;
  income: number;
  costs: number; // negative
  result: number;
  /** The budget for this cost centre, oriented the same way, or null. Always the whole year's (no monthly split). */
  budget: number | null;
}

interface TrendSection {
  /** A BAS section key, named in messages as `ledger.section.<key>`. */
  key: string;
  total: number;
}

interface TrendStack {
  month: string;
  /** Cost centre code (or "") to spend that month as a positive magnitude. Costs only. */
  values: Record<string, number>;
}

export interface LedgerTrend {
  months: TrendMonth[];
  costCenters: TrendCostCenter[];
  stack: TrendStack[];
  sections: TrendSection[];
  /** The compared budget's own result for the year, or null. */
  budgetTotal: number | null;
}

interface TrendOptions {
  financialYear: number;
  from: Date;
  to: Date;
  /** Only these cost centres, "" for the rows carrying none; undefined for all. */
  costCenterCodes?: string[];
  /** Raw öre net per `${account}|${costCenterCode}`. See lib/ledger/comparison. */
  budget?: Map<string, number> | null;
}

/** How busy a cost centre was (the ranking order), not its result. */
const turnover = (c: TrendCostCenter) => Math.abs(c.income) + Math.abs(c.costs);

/** "YYYY-MM" for a date, in UTC, which is the zone every ledger date is in. */
const monthKey = (d: Date): string =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

/** Every month from `from` to `to`, inclusive, in order. */
function monthsBetween(from: Date, to: Date): string[] {
  const out: string[] = [];
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
  const last = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1));
  while (cursor <= last) {
    out.push(monthKey(cursor));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return out;
}

export async function getLedgerTrend(opts: TrendOptions): Promise<LedgerTrend> {
  const { financialYear, from, to, costCenterCodes } = opts;
  const matches = costCenterMatcher(costCenterCodes);
  const sectionDefs = sectionsFor("RESULT");
  const sectionOf = (account: string): BasSection | undefined => {
    const n = Number(account);
    return Number.isFinite(n) ? sectionDefs.find((s) => n >= s.from && n <= s.to) : undefined;
  };

  // Per day and bucketed into months here, which avoids raw SQL (`date_trunc`).
  const grouped = await prisma.ledgerRow.groupBy({
    by: ["account", "costCenterCode", "costCenterName", "date"],
    where: {
      financialYear,
      date: { gte: from, lte: to },
      // A null code and an empty one are one bucket; the helper says so.
      ...costCenterWhere(costCenterCodes),
    },
    _sum: { debit: true, credit: true },
  });

  const months = monthsBetween(from, to);
  const monthIndex = new Map(months.map((m, i) => [m, i]));

  const income = months.map(() => 0);
  const costs = months.map(() => 0);
  const stack: TrendStack[] = months.map((month) => ({ month, values: {} }));

  interface CcTotals {
    code: string | null;
    name: string | null;
    income: number;
    costs: number;
  }
  const byCc = new Map<string, CcTotals>();
  const bySection = new Map<string, number>();

  for (const g of grouped) {
    const section = sectionOf(g.account);
    // Balance-sheet accounts are not part of a result.
    if (!section) continue;

    const i = monthIndex.get(monthKey(g.date));
    if (i === undefined) continue;

    const net = (g._sum.debit ?? 0) - (g._sum.credit ?? 0);
    const amount = oreToSEK(orient(net, section.orientation));
    const cc = g.costCenterCode ?? NO_CC;
    const isIncome = section.key === INCOME_SECTION;

    if (isIncome) income[i] += amount;
    else costs[i] += amount;

    const totals = byCc.get(cc) ?? {
      code: g.costCenterCode,
      name: g.costCenterName,
      income: 0,
      costs: 0,
    };
    totals.name ??= g.costCenterName;
    if (isIncome) totals.income += amount;
    else totals.costs += amount;
    byCc.set(cc, totals);

    bySection.set(section.key, (bySection.get(section.key) ?? 0) + amount);

    // The stack carries spending, so a month's income leaves no band.
    if (!isIncome) stack[i].values[cc] = (stack[i].values[cc] ?? 0) - amount;
  }

  let running = 0;
  const monthRows: TrendMonth[] = months.map((month, i) => {
    const result = income[i] + costs[i];
    running += result;
    return { month, income: income[i], costs: costs[i], result, cumulative: running };
  });

  // Oriented through the same section table so a budgeted cost lands negative like the actual one.
  const budgetByCc = new Map<string, number>();
  let budgetTotal: number | null = null;
  if (opts.budget) {
    budgetTotal = 0;
    for (const [key, net] of opts.budget) {
      const [account, cc = NO_CC] = key.split("|");
      const section = sectionOf(account);
      if (!section) continue;
      if (!matches(cc)) continue;
      const amount = oreToSEK(orient(net, section.orientation));
      budgetByCc.set(cc, (budgetByCc.get(cc) ?? 0) + amount);
      budgetTotal += amount;
    }
  }

  // A cost centre only the budget names still belongs on the ranking.
  const codes = new Set([...byCc.keys(), ...budgetByCc.keys()]);
  const names = await costCenterNames([...codes].filter((c) => c !== NO_CC && !byCc.get(c)?.name));

  const costCenters: TrendCostCenter[] = [...codes]
    .map((cc) => {
      const t = byCc.get(cc);
      return {
        code: cc === NO_CC ? null : cc,
        name: t?.name ?? (cc === NO_CC ? null : (names.get(cc) ?? null)),
        income: t?.income ?? 0,
        costs: t?.costs ?? 0,
        result: (t?.income ?? 0) + (t?.costs ?? 0),
        budget: opts.budget ? (budgetByCc.get(cc) ?? 0) : null,
      };
    })
    .sort((a, b) => turnover(b) - turnover(a));

  const sections: TrendSection[] = sectionDefs
    .filter((s) => s.key !== INCOME_SECTION && bySection.has(s.key))
    .map((s) => ({ key: s.key, total: bySection.get(s.key) ?? 0 }))
    .filter((s) => s.total !== 0);

  return { months: monthRows, costCenters, stack, sections, budgetTotal };
}

/** Names for cost centres only the budget mentions. */
async function costCenterNames(codes: string[]): Promise<Map<string, string>> {
  if (codes.length === 0) return new Map();
  const known = await prisma.costCenter.findMany({
    where: { code: { in: codes } },
    select: { code: true, name: true },
  });
  return new Map(known.map((c) => [c.code, c.name]));
}
