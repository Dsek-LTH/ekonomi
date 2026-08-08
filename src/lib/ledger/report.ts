// Fortnox-style reports over the local ledger mirror: a resultatrapport
// (3000–8999) and a balansrapport (1000–2999), for a month range within a
// financial year.
//
// Two groupings, per the report's own control:
//   SUMMED    — BAS section → account. Cost centres are summed away.
//   SPECIFIED — cost centre → BAS section → account.
//
// Amounts leave this module in SEK, already oriented for display (see lib/bas):
// income and equity read positive, costs read negative.
import { prisma } from "@/lib/server/db";
import {
  accountRangeFor,
  orient,
  sectionsFor,
  type BasSection,
  type ReportKind,
} from "./bas";

export type GroupMode = "SUMMED" | "SPECIFIED";

const ore = (v: number | null | undefined) => (v ?? 0) / 100;
const NO_CC = ""; // the "no cost centre" bucket key

export interface ReportAccount {
  account: string;
  accountName: string;
  amount: number; // SEK, oriented — period movement
  opening: number | null; // SEK, oriented — balance report only
  closing: number | null; // SEK, oriented — balance report only
  comparison: number | null; // SEK, oriented — prior year or budget
}

export interface ReportSection {
  /** Names the section in messages — see BasSection. */
  key: string;
  accounts: ReportAccount[];
  total: number;
  opening: number | null;
  closing: number | null;
  comparison: number | null;
}

// One per cost centre in SPECIFIED mode; a single unnamed group in SUMMED mode.
export interface ReportGroup {
  costCenterCode: string | null;
  costCenterName: string | null;
  sections: ReportSection[];
  total: number;
  opening: number | null;
  closing: number | null;
  comparison: number | null;
}

export interface LedgerReport {
  kind: ReportKind;
  group: GroupMode;
  groups: ReportGroup[];
  total: number;
  opening: number | null;
  closing: number | null;
  comparison: number | null;
}

// One account within one cost centre, in raw öre (debit − credit) before the
// display orientation is applied.
interface Cell {
  account: string;
  accountName: string;
  costCenterCode: string;
  costCenterName: string | null;
  opening: number; // at period start
  movement: number; // during the period
  comparison: number | null;
}

function inRange(account: string, kind: ReportKind): boolean {
  const n = Number(account);
  if (!Number.isFinite(n)) return false;
  const { from, to } = accountRangeFor(kind);
  return n >= from && n <= to;
}

// Sum the ledger over a date window, keyed by account + cost centre.
async function movements(
  financialYear: number,
  from: Date,
  to: Date,
): Promise<Map<string, Cell>> {
  const grouped = await prisma.ledgerRow.groupBy({
    by: ["account", "accountName", "costCenterCode", "costCenterName"],
    // The row's own year and date, not the voucher's — same values, but this
    // way the sum is an indexed scan of one table rather than a join over the
    // whole ledger. See LedgerRow in schema.prisma.
    where: { financialYear, date: { gte: from, lte: to } },
    _sum: { debit: true, credit: true },
  });

  const out = new Map<string, Cell>();
  for (const g of grouped) {
    const cc = g.costCenterCode ?? NO_CC;
    out.set(`${g.account}|${cc}`, {
      account: g.account,
      accountName: g.accountName,
      costCenterCode: cc,
      costCenterName: g.costCenterName,
      opening: 0,
      movement: (g._sum.debit ?? 0) - (g._sum.credit ?? 0),
      comparison: null,
    });
  }
  return out;
}

// Opening balance per account + cost centre at the start of the period.
//
// The year's #IB is an account-level fact. #OIB gives the per-cost-centre split
// when the exporter emits it; when it doesn't, the whole opening balance lands
// in the "no cost centre" bucket rather than being silently spread around. Any
// part of an account's #IB not covered by its #OIB rows lands there too, so the
// buckets always add back up to the account total.
async function openingBalances(
  financialYear: number,
  periodStart: Date,
  yearStart: Date,
): Promise<Map<string, Cell>> {
  const balances = await prisma.ledgerAccountBalance.findMany({ where: { financialYear } });

  const out = new Map<string, Cell>();
  const add = (
    account: string,
    accountName: string,
    cc: string,
    amount: number,
  ) => {
    const key = `${account}|${cc}`;
    const cell = out.get(key);
    if (cell) cell.opening += amount;
    else
      out.set(key, {
        account,
        accountName,
        costCenterCode: cc,
        costCenterName: null,
        opening: amount,
        movement: 0,
        comparison: null,
      });
  };

  const byAccount = new Map<string, typeof balances>();
  for (const b of balances) {
    const list = byAccount.get(b.account) ?? [];
    list.push(b);
    byAccount.set(b.account, list);
  }
  for (const [account, list] of byAccount) {
    const total = list.find((b) => b.costCenterCode === NO_CC);
    const split = list.filter((b) => b.costCenterCode !== NO_CC);
    const name = total?.accountName ?? split[0]?.accountName ?? "";
    for (const s of split) add(account, name, s.costCenterCode, s.opening);
    // Remainder (or the whole thing, when there is no #OIB detail).
    const covered = split.reduce((s, b) => s + b.opening, 0);
    const remainder = (total?.opening ?? 0) - covered;
    if (remainder !== 0 || split.length === 0) {
      add(account, name, NO_CC, total ? remainder : 0);
    }
  }

  // A period starting mid-year carries the movements from the year's start up
  // to the day before it.
  if (periodStart > yearStart) {
    const before = new Date(periodStart);
    before.setUTCDate(before.getUTCDate() - 1);
    for (const cell of (await movements(financialYear, yearStart, before)).values()) {
      add(cell.account, cell.accountName, cell.costCenterCode, cell.movement);
    }
  }

  return out;
}

export interface ReportOptions {
  financialYear: number;
  kind: ReportKind;
  from: Date; // period start, inclusive
  to: Date; // period end, inclusive
  yearStart: Date; // the financial year's own first day
  costCenterCode?: string; // filter to a single cost centre
  group: GroupMode;
  // Raw öre net (debit − credit) per `${account}|${costCenterCode}` to show
  // alongside the period — prior year or budget. See lib/ledger/comparison.
  comparison?: Map<string, number> | null;
}

export async function getLedgerReport(opts: ReportOptions): Promise<LedgerReport> {
  const { financialYear, kind, from, to, yearStart, group } = opts;
  const isBalance = kind === "BALANCE";

  const cells = new Map<string, Cell>();
  const merge = (src: Map<string, Cell>, field: "opening" | "movement") => {
    for (const [key, c] of src) {
      if (!inRange(c.account, kind)) continue;
      const existing = cells.get(key);
      if (existing) {
        existing[field] += c[field];
        existing.costCenterName ??= c.costCenterName;
        existing.accountName ||= c.accountName;
      } else {
        cells.set(key, { ...c });
      }
    }
  };

  merge(await movements(financialYear, from, to), "movement");
  // Only the balance report carries balances forward; result accounts restart
  // at zero each financial year.
  if (isBalance) merge(await openingBalances(financialYear, from, yearStart), "opening");

  if (opts.comparison) {
    for (const [key, raw] of opts.comparison) {
      const [account, cc = NO_CC] = key.split("|");
      if (!inRange(account, kind)) continue;
      const existing = cells.get(key);
      if (existing) existing.comparison = (existing.comparison ?? 0) + raw;
      else
        cells.set(key, {
          account,
          accountName: "",
          costCenterCode: cc,
          costCenterName: null,
          opening: 0,
          movement: 0,
          comparison: raw,
        });
    }
  }

  // Fill in cost-centre names the ledger rows didn't supply (balance-only
  // accounts have no rows to denormalise a name from).
  const missingNames = [...cells.values()].filter((c) => c.costCenterCode && !c.costCenterName);
  if (missingNames.length) {
    const known = await prisma.costCenter.findMany({
      where: { code: { in: [...new Set(missingNames.map((c) => c.costCenterCode))] } },
      select: { code: true, name: true },
    });
    const nameByCode = new Map(known.map((c) => [c.code, c.name]));
    for (const c of missingNames) c.costCenterName = nameByCode.get(c.costCenterCode) ?? null;
  }

  let list = [...cells.values()];
  if (opts.costCenterCode !== undefined) {
    list = list.filter((c) => c.costCenterCode === opts.costCenterCode);
  }
  // Drop rows that carry nothing at all — an account touched only outside the
  // period would otherwise show up as a row of zeroes.
  list = list.filter(
    (c) => c.movement !== 0 || c.opening !== 0 || (c.comparison ?? 0) !== 0,
  );

  const buckets =
    group === "SPECIFIED"
      ? groupByCostCenter(list)
      : [{ code: null, name: null, cells: mergeAcrossCostCenters(list) }];

  const groups = buckets.map((b) => buildGroup(b.code, b.name, b.cells, kind, isBalance));
  const sum = (pick: (g: ReportGroup) => number | null) =>
    groups.reduce((s, g) => s + (pick(g) ?? 0), 0);

  return {
    kind,
    group,
    groups,
    total: sum((g) => g.total),
    opening: isBalance ? sum((g) => g.opening) : null,
    closing: isBalance ? sum((g) => g.closing) : null,
    comparison: opts.comparison ? sum((g) => g.comparison) : null,
  };
}

function groupByCostCenter(list: Cell[]) {
  const byCc = new Map<string, { code: string | null; name: string | null; cells: Cell[] }>();
  for (const c of list) {
    const bucket = byCc.get(c.costCenterCode) ?? {
      code: c.costCenterCode || null,
      name: c.costCenterName,
      cells: [],
    };
    bucket.name ??= c.costCenterName;
    bucket.cells.push(c);
    byCc.set(c.costCenterCode, bucket);
  }
  return [...byCc.values()].sort((a, b) => {
    // Named cost centres first (by code), the unattributed bucket last.
    if (!a.code) return 1;
    if (!b.code) return -1;
    return a.code.localeCompare(b.code);
  });
}

// SUMMED mode: collapse each account's cost-centre rows into one.
function mergeAcrossCostCenters(list: Cell[]): Cell[] {
  const byAccount = new Map<string, Cell>();
  for (const c of list) {
    const existing = byAccount.get(c.account);
    if (existing) {
      existing.opening += c.opening;
      existing.movement += c.movement;
      if (c.comparison != null) existing.comparison = (existing.comparison ?? 0) + c.comparison;
      existing.accountName ||= c.accountName;
    } else {
      byAccount.set(c.account, { ...c, costCenterCode: NO_CC, costCenterName: null });
    }
  }
  return [...byAccount.values()];
}

function buildGroup(
  code: string | null,
  name: string | null,
  cells: Cell[],
  kind: ReportKind,
  isBalance: boolean,
): ReportGroup {
  const bySection = new Map<string, Cell[]>();
  const sectionDefs = sectionsFor(kind);
  const sectionOf = (account: string): BasSection | undefined => {
    const n = Number(account);
    return sectionDefs.find((s) => n >= s.from && n <= s.to);
  };

  for (const c of cells) {
    const section = sectionOf(c.account);
    if (!section) continue;
    const list = bySection.get(section.key) ?? [];
    list.push(c);
    bySection.set(section.key, list);
  }

  const sections: ReportSection[] = [];
  for (const def of sectionDefs) {
    const list = bySection.get(def.key);
    if (!list?.length) continue;

    const accounts: ReportAccount[] = list
      .map((c) => ({
        account: c.account,
        accountName: c.accountName,
        amount: ore(orient(c.movement, def.orientation)),
        opening: isBalance ? ore(orient(c.opening, def.orientation)) : null,
        closing: isBalance ? ore(orient(c.opening + c.movement, def.orientation)) : null,
        comparison: c.comparison == null ? null : ore(orient(c.comparison, def.orientation)),
      }))
      .sort((a, b) => a.account.localeCompare(b.account));

    const anyComparison = accounts.some((a) => a.comparison != null);
    sections.push({
      key: def.key,
      accounts,
      total: accounts.reduce((s, a) => s + a.amount, 0),
      opening: isBalance ? accounts.reduce((s, a) => s + (a.opening ?? 0), 0) : null,
      closing: isBalance ? accounts.reduce((s, a) => s + (a.closing ?? 0), 0) : null,
      comparison: anyComparison ? accounts.reduce((s, a) => s + (a.comparison ?? 0), 0) : null,
    });
  }

  const anyComparison = sections.some((s) => s.comparison != null);
  return {
    costCenterCode: code,
    costCenterName: name,
    sections,
    total: sections.reduce((s, x) => s + x.total, 0),
    opening: isBalance ? sections.reduce((s, x) => s + (x.opening ?? 0), 0) : null,
    closing: isBalance ? sections.reduce((s, x) => s + (x.closing ?? 0), 0) : null,
    comparison: anyComparison ? sections.reduce((s, x) => s + (x.comparison ?? 0), 0) : null,
  };
}
