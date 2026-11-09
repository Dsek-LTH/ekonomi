import type { IncomeReportStatus } from "@/lib/domain/types";
import type { IncomeReportRow } from "@/lib/data/income";
import { inFiscalYear, type FiscalYear } from "@/lib/ui/fiscal-year";

export const INCOME_TABS = ["book", "export", "done", "all"] as const;
export type IncomeTab = (typeof INCOME_TABS)[number];

const INCOME_TAB_STATUS: Record<Exclude<IncomeTab, "all">, IncomeReportStatus> = {
  book: "DRAFT",
  export: "BOOKED",
  done: "EXPORTED",
};

/** The stage that needs the reader: days to kontera for whoever books, everything for a revisor. */
export const incomeDefaultTab = (canBook: boolean): IncomeTab => (canBook ? "book" : "all");

export const tabOf = (status: IncomeReportStatus): IncomeTab =>
  status === "DRAFT" ? "book" : status === "BOOKED" ? "export" : "done";

/** Which reports a stage holds in a year, by the day of the takings. */
export function incomeTabHolds(tab: IncomeTab, year: FiscalYear | null) {
  const holds = (r: IncomeReportRow) => tab === "all" || r.status === INCOME_TAB_STATUS[tab];
  if (!year) return holds;
  return (r: IncomeReportRow) => holds(r) && inFiscalYear(year, r.date);
}
