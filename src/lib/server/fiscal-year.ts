import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import { getLedgerYears } from "@/lib/ledger";
import { today } from "@/lib/domain/date";
import { FISCAL_YEAR_COOKIE, type FiscalYear } from "@/lib/ui/fiscal-year";

/**
 * Every financial year Fortnox has, as far as the ledger has been synced,
 * newest first. What the header's picker offers. Empty when nothing has been
 * synced yet, and then there is no picker and nothing is narrowed.
 */
export const getFiscalYears = cache(async (): Promise<FiscalYear[]> =>
  (await getLedgerYears()).map((y) => ({ id: y.id, fromDate: y.fromDate, toDate: y.toDate })),
);

/**
 * The year the reader is looking at: the one they picked, if Fortnox still
 * has it, otherwise the one today falls in, otherwise the newest there is.
 * Cached per request, so the layout and the page agree without asking twice.
 */
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

/** A year's bounds as a Prisma date filter. What the data layer takes as
 *  `during`, for a `@db.Date` column or a timestamp alike. */
export type During = { gte: Date; lte: Date };

/** The year's bounds as a Prisma date filter, for a `@db.Date` column. */
export function fiscalYearWhere(y: FiscalYear): During {
  return {
    gte: new Date(`${y.fromDate}T00:00:00.000Z`),
    lte: new Date(`${y.toDate}T23:59:59.999Z`),
  };
}
