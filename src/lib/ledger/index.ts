// Queries over the local Fortnox ledger mirror (see lib/fortnox/sync.ts).
// Amounts are returned in SEK (the rest of the UI works in SEK), except the
// budget-vs-actual helper which stays in öre for exact matching.
import { prisma } from "@/lib/server/db";

const ore = (v: number | null | undefined) => (v ?? 0) / 100;

export interface LedgerYear {
  id: number; // Fortnox financial-year id
  year: number; // calendar year (from FromDate)
  lastSyncAt: string | null; // ISO
  // The year's own span, so the report can offer exactly its months — a broken
  // financial year doesn't start in January.
  fromDate: string; // YYYY-MM-DD
  toDate: string; // YYYY-MM-DD
}

export async function getLedgerYears(): Promise<LedgerYear[]> {
  const years = await prisma.fortnoxFinancialYear.findMany({ orderBy: { fromDate: "desc" } });
  return years.map((y) => ({
    id: y.id,
    year: y.fromDate.getUTCFullYear(),
    lastSyncAt: y.lastSyncAt?.toISOString() ?? null,
    fromDate: y.fromDate.toISOString().slice(0, 10),
    toDate: y.toDate.toISOString().slice(0, 10),
  }));
}

// Resolve a Fortnox financial-year id from a calendar year (the budget works in
// calendar years). Returns null if that year hasn't been synced.
export async function financialYearIdForCalendarYear(year: number): Promise<number | null> {
  const fy = await prisma.fortnoxFinancialYear.findFirst({
    where: {
      fromDate: { gte: new Date(Date.UTC(year, 0, 1)) },
      toDate: { lte: new Date(Date.UTC(year, 11, 31)) },
    },
  });
  return fy?.id ?? null;
}

export interface LedgerRowView {
  id: string;
  date: string; // ISO
  voucher: string; // e.g. "A-42"
  description: string; // voucher text
  text: string | null; // transaction text
  costCenter: string | null; // "code – name", for the summed grouping
  debit: number; // SEK
  credit: number; // SEK
}

// Individual voucher rows behind a (year, cost centre, account) cell — the
// drill-down for the report. `costCenterCode` distinguishes three cases:
// a code scopes to that cost centre, null scopes to the "no cost centre"
// bucket, and undefined spans every cost centre (the summed grouping).
export async function getLedgerRows(
  financialYear: number,
  account: string,
  costCenterCode: string | null | undefined,
  period?: { from: Date; to: Date },
): Promise<LedgerRowView[]> {
  const rows = await prisma.ledgerRow.findMany({
    where: {
      financialYear,
      account,
      ...(costCenterCode === undefined ? {} : { costCenterCode }),
      ...(period ? { date: { gte: period.from, lte: period.to } } : {}),
    },
    // The voucher is still joined — this is the drill-down, and its series,
    // number and description are the whole point of it. What moved off the
    // relation is the *filtering*, which is what had to read every row.
    include: { voucher: true },
    // On the row's own date, so the sort is served by the same index as the
    // filter. It ties for rows of one voucher, hence the tiebreaker — without
    // one, tied rows come back in whatever order the plan produces.
    orderBy: [{ date: "asc" }, { id: "asc" }],
    take: 500,
  });
  return rows.map((r) => ({
    id: r.id,
    date: r.voucher.date.toISOString().slice(0, 10),
    voucher: `${r.voucher.series}-${r.voucher.number}`,
    description: r.voucher.description,
    text: r.text,
    costCenter: r.costCenterCode
      ? `${r.costCenterCode}${r.costCenterName ? ` – ${r.costCenterName}` : ""}`
      : null,
    debit: ore(r.debit),
    credit: ore(r.credit),
  }));
}

// Actuals for budget-vs-actual, keyed `${costCenterCode}|${account}` → öre net.
// net is signed so the caller can apply income/cost orientation. Returns an
// empty map (not an error) when the year hasn't been synced.
export async function getActualsByAccountCostCenter(
  calendarYear: number,
): Promise<Map<string, { debit: number; credit: number }>> {
  const fyId = await financialYearIdForCalendarYear(calendarYear);
  const out = new Map<string, { debit: number; credit: number }>();
  if (fyId == null) return out;

  const grouped = await prisma.ledgerRow.groupBy({
    by: ["costCenterCode", "account"],
    where: { financialYear: fyId },
    _sum: { debit: true, credit: true },
  });
  for (const g of grouped) {
    const key = `${g.costCenterCode ?? ""}|${g.account}`;
    out.set(key, { debit: g._sum.debit ?? 0, credit: g._sum.credit ?? 0 });
  }
  return out;
}
