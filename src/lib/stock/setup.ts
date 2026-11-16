// What a stock still needs before its value can be posted to Fortnox. Pure over the settings, shared by the
// settings page (which lists what is missing) and the export (which refuses until nothing is). See docs/stock.md.

import { STOCKS, type StockSlug } from "./stocks";

export interface StockBookingSettings {
  stock: StockSlug;
  purchaseMode: "CAPITALISED" | "EXPENSED";
  purchaseOffsetAccount: string | null;
  boardCostAccount: string | null;
  boardSalesAccount: string | null;
  postingStartsOn: string | null;
  groups: readonly {
    name: string;
    stockAccount: string | null;
    consumptionAccount: string | null;
    /** How many products are of this type. A type nothing is in needs no accounts yet. */
    products: number;
  }[];
}

/** One thing still to choose. `group` names the product type it is about, where it is about one. */
export interface StockSetupGap {
  key:
    | "stockAccount"
    | "consumptionAccount"
    | "purchaseOffsetAccount"
    | "boardCostAccount"
    | "postingStartsOn";
  group?: string;
}

/**
 * What is missing before a day can be posted. Cost centres are not here: a row may go without one. The board's
 * sales account is not here either, since it is only needed for the year-end invoices (`boardInvoiceGaps`).
 */
export function postingGaps(s: StockBookingSettings): StockSetupGap[] {
  const gaps: StockSetupGap[] = [];
  for (const g of s.groups) {
    if (g.products === 0) continue;
    if (!g.stockAccount) gaps.push({ key: "stockAccount", group: g.name });
    if (!g.consumptionAccount) gaps.push({ key: "consumptionAccount", group: g.name });
  }
  // A delivery is taken into stock by crediting the cost it was booked on.
  if (s.purchaseMode === "EXPENSED" && !s.purchaseOffsetAccount) {
    gaps.push({ key: "purchaseOffsetAccount" });
  }
  if (STOCKS[s.stock].allowsBoardWithdrawals && !s.boardCostAccount) {
    gaps.push({ key: "boardCostAccount" });
  }
  if (!s.postingStartsOn) gaps.push({ key: "postingStartsOn" });
  return gaps;
}

/** Whether the board's year-end invoices can be made: they need an account to credit. */
export const boardInvoicesReady = (s: StockBookingSettings): boolean =>
  !STOCKS[s.stock].allowsBoardWithdrawals || Boolean(s.boardSalesAccount);
