// Intäkter's stages, shared by the page and the table. Its own module because
// page.tsx runs on the server and cannot read values out of a "use client"
// file. See docs/navigation.md.
import type { IncomeReportStatus } from "@/lib/domain/types";
import type { IncomeReportRow } from "@/lib/data/income";
import { inFiscalYear, type FiscalYear } from "@/lib/ui/fiscal-year";

/** The stages, as `?tab=` values, each named for who acts next. */
export const INCOME_TABS = ["review", "booked", "exported", "all"] as const;
export type IncomeTab = (typeof INCOME_TABS)[number];

/** Which status each stage holds. "all" holds every one. */
export const INCOME_TAB_STATUS: Record<Exclude<IncomeTab, "all">, IncomeReportStatus> = {
  review: "DRAFT",
  booked: "BOOKED",
  exported: "EXPORTED",
};

/** The stage that needs the reader: the days to book for whoever books
 *  them, everything for a reader (a revisor), who books nothing. */
export const incomeDefaultTab = (canBook: boolean): IncomeTab => (canBook ? "review" : "all");

/** Which reports a stage holds in a year, by the day of the takings, on every
 *  stage, the work ones too. See docs/navigation.md. */
export function incomeTabHolds(tab: IncomeTab, year: FiscalYear | null) {
  const holds = (r: IncomeReportRow) => tab === "all" || r.status === INCOME_TAB_STATUS[tab];
  if (!year) return holds;
  return (r: IncomeReportRow) => holds(r) && inFiscalYear(year, r.date);
}
