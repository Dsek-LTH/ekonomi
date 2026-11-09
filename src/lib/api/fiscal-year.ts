// Rule on what a route will write: something new is made in the year picked in the header. The forms warn first
// (outsideFiscalYear in lib/ui/fiscal-year.ts); this is where it holds. See docs/navigation.md.
import "server-only";

import type { NextResponse } from "next/server";
import { fail } from "@/lib/api/guard";
import { getFiscalYear } from "@/lib/server/fiscal-year";
import { fiscalYearLabel, outsideFiscalYear } from "@/lib/ui/fiscal-year";
import { isoDay } from "@/lib/domain/date";

/** A 422 for a date outside the picked year, or null (also null for no date, or before any year is synced). */
export async function denyOutsideFiscalYear(
  date: string | Date | null | undefined,
): Promise<NextResponse | null> {
  if (!date) return null;
  const day = typeof date === "string" ? date : isoDay(date);
  const year = await getFiscalYear();
  if (!outsideFiscalYear(year, day)) return null;
  return fail(422, "fiscalYear.outside", { values: { year: fiscalYearLabel(year!) } });
}

/** The same for a budget, kept by calendar year: the year the picked räkenskapsår starts in. */
export async function denyBudgetOutsideFiscalYear(
  budgetYear: number,
): Promise<NextResponse | null> {
  const year = await getFiscalYear();
  if (!year || Number(year.fromDate.slice(0, 4)) === budgetYear) return null;
  return fail(422, "fiscalYear.outside", { values: { year: fiscalYearLabel(year) } });
}
