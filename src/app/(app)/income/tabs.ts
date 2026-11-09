// The stages of a day of takings, as the tabs of Intäkter's lists.
//
// The same stages and the same words as Utlägg (docs/navigation.md): a day is
// konterad here, then granskad and bokförd in Fortnox by somebody else.
import type { IncomeReportStatus } from "@/lib/domain/types";
import type { IncomeReportRow } from "@/lib/data/income";
import { inFiscalYear, type FiscalYear } from "@/lib/ui/fiscal-year";

/** The stages, as `?tab=` values, each named for what happens next. */
export const INCOME_TABS = ["book", "export", "done", "all"] as const;
export type IncomeTab = (typeof INCOME_TABS)[number];

/** Which status each stage holds. "all" holds every one. */
const INCOME_TAB_STATUS: Record<Exclude<IncomeTab, "all">, IncomeReportStatus> = {
  book: "DRAFT",
  export: "BOOKED",
  done: "EXPORTED",
};

/** The stage that needs the reader: the days to kontera for whoever books,
 *  everything for a reader (a revisor), who books nothing. */
export const incomeDefaultTab = (canBook: boolean): IncomeTab => (canBook ? "book" : "all");

/** The tab a status is listed under. */
export const tabOf = (status: IncomeReportStatus): IncomeTab =>
  status === "DRAFT" ? "book" : status === "BOOKED" ? "export" : "done";

/** Which reports a stage holds in a year, by the day of the takings, on every
 *  stage, the work ones too. See docs/navigation.md. */
export function incomeTabHolds(tab: IncomeTab, year: FiscalYear | null) {
  const holds = (r: IncomeReportRow) => tab === "all" || r.status === INCOME_TAB_STATUS[tab];
  if (!year) return holds;
  return (r: IncomeReportRow) => holds(r) && inFiscalYear(year, r.date);
}
