import type { IncomeReportStatus } from "@/lib/domain/types";

export const INCOME_TABS = ["book", "export", "done", "all"] as const;
export type IncomeTab = (typeof INCOME_TABS)[number];

// The status behind each tab is in lib/data/income.ts (INCOME_TAB_STATUS).

/** The stage that needs the reader: days to kontera for whoever books, everything for a revisor. */
export const incomeDefaultTab = (canBook: boolean): IncomeTab => (canBook ? "book" : "all");

export const tabOf = (status: IncomeReportStatus): IncomeTab =>
  status === "DRAFT" ? "book" : status === "BOOKED" ? "export" : "done";
