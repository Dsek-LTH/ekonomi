// Queries over the local Fortnox ledger mirror (see lib/fortnox/sync.ts).
// Amounts are returned in SEK (the rest of the UI works in SEK), except the
// budget-vs-actual helper which stays in öre for exact matching.
import { prisma } from "@/lib/server/db";
import { oreToSEK } from "@/lib/domain/money";
import { costCenterWhere } from "./cost-center-filter";
import { isoDay } from "@/lib/domain/date";

export interface LedgerYear {
  id: number; // Fortnox financial-year id
  year: number; // calendar year (from FromDate)
  lastSyncAt: string | null; // ISO
  // The year's own span. A broken financial year doesn't start in January.
  fromDate: string; // YYYY-MM-DD
  toDate: string; // YYYY-MM-DD
}

export async function getLedgerYears(): Promise<LedgerYear[]> {
  const years = await prisma.fortnoxFinancialYear.findMany({ orderBy: { fromDate: "desc" } });
  return years.map((y) => ({
    id: y.id,
    year: y.fromDate.getUTCFullYear(),
    lastSyncAt: y.lastSyncAt?.toISOString() ?? null,
    fromDate: isoDay(y.fromDate),
    toDate: isoDay(y.toDate),
  }));
}

// Resolve a Fortnox financial-year id from a calendar year. Null if that year hasn't been synced.
export async function financialYearIdForCalendarYear(year: number): Promise<number | null> {
  const fy = await prisma.fortnoxFinancialYear.findFirst({
    where: {
      fromDate: { gte: new Date(Date.UTC(year, 0, 1)) },
      toDate: { lte: new Date(Date.UTC(year, 11, 31)) },
    },
  });
  return fy?.id ?? null;
}

interface LedgerRowView {
  id: string;
  date: string; // ISO
  voucher: string; // e.g. "A-42"
  description: string; // voucher text
  text: string | null; // transaction text
  costCenter: string | null; // "code - name", for the summed grouping
  debit: number; // SEK
  credit: number; // SEK
}

// Voucher rows behind a (year, cost centre, account) cell: the report drill-down. `costCenterCodes` is the
// report's filter, "" meaning the "no cost centre" bucket (cost-center-filter.ts).
export async function getLedgerRows(
  financialYear: number,
  account: string,
  costCenterCodes: string[] | undefined,
  period?: { from: Date; to: Date },
): Promise<LedgerRowView[]> {
  const rows = await prisma.ledgerRow.findMany({
    where: {
      financialYear,
      account,
      ...costCenterWhere(costCenterCodes),
      ...(period ? { date: { gte: period.from, lte: period.to } } : {}),
    },
    include: { voucher: true },
    // On the row's own date, served by the filter's index; the id tiebreaker orders rows of one voucher.
    orderBy: [{ date: "asc" }, { id: "asc" }],
    take: 500,
  });
  return rows.map((r) => ({
    id: r.id,
    date: isoDay(r.voucher.date),
    voucher: `${r.voucher.series}-${r.voucher.number}`,
    description: r.voucher.description,
    text: r.text,
    costCenter: r.costCenterCode
      ? `${r.costCenterCode}${r.costCenterName ? ` - ${r.costCenterName}` : ""}`
      : null,
    debit: oreToSEK(r.debit),
    credit: oreToSEK(r.credit),
  }));
}

// Actuals for budget-vs-actual, keyed `${costCenterCode}|${account}` to öre net (signed). Empty map when the year isn't synced.
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
