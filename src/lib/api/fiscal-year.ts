// The räkenskapsår as a rule on what a route will write: something new is made
// in the year the reader has picked in the header, so it lands in the list it
// was made from. The forms say so first (outsideFiscalYear in
// lib/ui/fiscal-year.ts); this is where it holds. See docs/navigation.md.
import "server-only";

import type { NextResponse } from "next/server";
import { fail } from "@/lib/api/guard";
import { getFiscalYear } from "@/lib/server/fiscal-year";
import { fiscalYearLabel, outsideFiscalYear } from "@/lib/ui/fiscal-year";

/**
 * A 422 for a date outside the picked year, or null when it is in it. Null as
 * well for no date, and before any year has been synced, when there is no
 * year to keep to.
 */
export async function denyOutsideFiscalYear(
  date: string | Date | null | undefined,
): Promise<NextResponse | null> {
  if (!date) return null;
  const day = typeof date === "string" ? date : date.toISOString().slice(0, 10);
  const year = await getFiscalYear();
  if (!outsideFiscalYear(year, day)) return null;
  return fail(422, "fiscalYear.outside", { values: { year: fiscalYearLabel(year!) } });
}

/**
 * The same for a budget, which is kept by calendar year rather than by date:
 * the year the picked räkenskapsår starts in, as the Budget list reads it.
 */
export async function denyBudgetOutsideFiscalYear(budgetYear: number): Promise<NextResponse | null> {
  const year = await getFiscalYear();
  if (!year || Number(year.fromDate.slice(0, 4)) === budgetYear) return null;
  return fail(422, "fiscalYear.outside", { values: { year: fiscalYearLabel(year) } });
}
