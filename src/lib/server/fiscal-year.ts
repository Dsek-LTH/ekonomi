import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import { getLedgerYears } from "@/lib/ledger";
import { today } from "@/lib/domain/date";
import { FISCAL_YEAR_COOKIE, type FiscalYear } from "@/lib/ui/fiscal-year";

/** Every financial year Fortnox has (as far as the ledger is synced), newest first. Empty before any sync. */
export const getFiscalYears = cache(async (): Promise<FiscalYear[]> =>
  (await getLedgerYears()).map((y) => ({ id: y.id, fromDate: y.fromDate, toDate: y.toDate })),
);

/** The year the reader is looking at: the one picked if Fortnox has it, else today's, else the newest. Cached per request. */
export const getFiscalYear = cache(async (): Promise<FiscalYear | null> => {
  const years = await getFiscalYears();
  if (years.length === 0) return null;
  const picked = Number((await cookies()).get(FISCAL_YEAR_COOKIE)?.value);
  const now = today();
  return (
    years.find((y) => y.id === picked) ??
    years.find((y) => y.fromDate <= now && now <= y.toDate) ??
    years[0]
  );
});

/** A year's bounds as a Prisma date filter (`during`), for a `@db.Date` column or a timestamp. */
export type During = { gte: Date; lte: Date };

/** The year's bounds as a Prisma date filter, for a `@db.Date` column. */
export function fiscalYearWhere(y: FiscalYear): During {
  return {
    gte: new Date(`${y.fromDate}T00:00:00.000Z`),
    lte: new Date(`${y.toDate}T23:59:59.999Z`),
  };
}
