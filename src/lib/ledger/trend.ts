// The same ledger the utfall table reads, cut the four ways a chart needs it.
//
// The report next door answers "what does each account come to over this
// period", which is the question a table is good at. None of these are that:
// they are the shape of the period rather than its contents, and every one of
// them is a question the table can only be squinted at to answer.
//
//   months        the result month by month, and running
//   costCenters   what each cost centre came to over the whole period
//   stack         each cost centre's costs month by month
//   sections      what kind of cost the period's money went to
//
// All four come out of one query. They are four projections of the same rows,
// so computing them separately would be four scans of the largest table in the
// app to produce four things that cannot disagree anyway.
//
// Amounts leave here in SEK, already oriented the way the report orients them:
// income reads positive, costs read negative, and a result is their sum. The
// charts then never have to know which way a BAS account points.
import { prisma } from "@/lib/server/db";
import { orient, sectionsFor, type BasSection } from "./bas";
import { oreToSEK } from "@/lib/domain/money";

/** The bucket key for rows carrying no cost centre. The report uses the same. */
const NO_CC = "";

/** The BAS section that is money coming in. Everything else in a result report
 *  is money going out, which is what makes `income`/`costs` a split of two. */
const INCOME_SECTION = "intakter";

export interface TrendMonth {
  /** "YYYY-MM". Every month of the period is here, including empty ones: a
   *  month nothing happened in is a fact about the year, not a gap to close. */
  month: string;
  income: number;
  costs: number; // negative
  result: number; // income + costs
  /** The result summed from the period's first month up to and including this
   *  one. On the chart it is the line you follow to see when a year turned. */
  cumulative: number;
}

export interface TrendCostCenter {
  /** Null for the rows that carry none. */
  code: string | null;
  name: string | null;
  income: number;
  costs: number; // negative
  result: number;
  /**
   * What the budget planned for this cost centre, oriented the same way, or
   * null when no budget was compared against.
   *
   * The whole year's, always, however short the period is: a budget carries no
   * monthly split, so there is nothing honest to cut it down to. Whatever shows
   * this has to say so.
   */
  budget: number | null;
}

interface TrendSection {
  /** A BAS section key, named in messages as `ledger.section.<key>`. */
  key: string;
  total: number;
}

interface TrendStack {
  month: string;
  /** Cost centre code (or "" for none) → what it spent that month, as a
   *  positive magnitude. Costs only: a stack of results, which change sign
   *  between committees and between months, is a shape with no meaning. */
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
  /** A code scopes to it, "" to the rows carrying none, undefined to all. */
  costCenterCode?: string;
  /** Raw öre net per `${account}|${costCenterCode}`. See lib/ledger/comparison. */
  budget?: Map<string, number> | null;
}

/** How busy a cost centre was, which is what the ranking is ordered on. Not its
 *  result: one that took in 200 000 and spent 200 000 is among the busiest in
 *  the section, and its result is zero. */
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
  const { financialYear, from, to, costCenterCode } = opts;
  const sectionDefs = sectionsFor("RESULT");
  const sectionOf = (account: string): BasSection | undefined => {
    const n = Number(account);
    return Number.isFinite(n) ? sectionDefs.find((s) => n >= s.from && n <= s.to) : undefined;
  };

  // The date is in the grouping, which is what makes this a series rather than
  // a total. It comes back per day and is bucketed into months here rather than
  // by the database: `date_trunc` would mean raw SQL for the one query in this
  // module that could avoid it, and the row count a financial year produces at
  // this grain is a few thousand, which is a list, not a problem.
  const grouped = await prisma.ledgerRow.groupBy({
    by: ["account", "costCenterCode", "costCenterName", "date"],
    where: {
      financialYear,
      date: { gte: from, lte: to },
      // The report treats a null code and an empty one as the same bucket (see
      // `movements`), so the filter has to as well, or asking for "utan
      // kostnadsställe" would answer with a subset of what the table shows.
      ...(costCenterCode === undefined
        ? {}
        : costCenterCode === NO_CC
          ? { OR: [{ costCenterCode: null }, { costCenterCode: "" }] }
          : { costCenterCode }),
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
    // Balance-sheet accounts are in the same table and are not part of a
    // result. Skipping them here is what makes every figure below a result
    // figure without anything having to say so again.
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

  // The budget, per cost centre and in total. Oriented through the same section
  // table, so a budgeted cost lands negative exactly as the actual one does and
  // the two can be drawn on one axis.
  const budgetByCc = new Map<string, number>();
  let budgetTotal: number | null = null;
  if (opts.budget) {
    budgetTotal = 0;
    for (const [key, net] of opts.budget) {
      const [account, cc = NO_CC] = key.split("|");
      const section = sectionOf(account);
      if (!section) continue;
      if (costCenterCode !== undefined && cc !== costCenterCode) continue;
      const amount = oreToSEK(orient(net, section.orientation));
      budgetByCc.set(cc, (budgetByCc.get(cc) ?? 0) + amount);
      budgetTotal += amount;
    }
  }

  // A cost centre the budget names but the ledger never touched still belongs
  // on the ranking: "budgeted 40 000, spent nothing" is one of the things the
  // chart exists to show.
  const codes = new Set([...byCc.keys(), ...budgetByCc.keys()]);
  const names = await costCenterNames(
    [...codes].filter((c) => c !== NO_CC && !byCc.get(c)?.name),
  );

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

/** Names for cost centres the ledger rows had none for, which is every one that
 *  only the budget mentions. */
async function costCenterNames(codes: string[]): Promise<Map<string, string>> {
  if (codes.length === 0) return new Map();
  const known = await prisma.costCenter.findMany({
    where: { code: { in: codes } },
    select: { code: true, name: true },
  });
  return new Map(known.map((c) => [c.code, c.name]));
}
