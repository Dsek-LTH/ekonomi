import type { ClosingCheck } from "@/lib/domain/types";
import { isoDay } from "@/lib/domain/date";

export const CLOSING_CHECKS: readonly ClosingCheck[] = [
  "EXPENSES_EXPORTED",
  "CARD_PURCHASES_ACCOUNTED",
  "INCOME_EXPORTED",
  "STOCKTAKE_AT_YEAR_END",
  "LEDGER_SYNCED",
  "BALANCES_RECONCILED",
  "TREASURY_REVIEWED",
  "AUDITORS_REVIEWED",
];

export interface CheckResult {
  remaining: number;
  href: string | null;
}

export function dueDateFor(yearEnd: string, offset: number | null): string | null {
  if (offset === null) return null;
  const d = new Date(`${yearEnd}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return isoDay(d);
}

/** Done when the check finds nothing left (whatever was ticked); without a check, when ticked. */
export function isItemDone(item: { doneAt: string | null; check: CheckResult | null }): boolean {
  return item.check ? item.check.remaining === 0 : item.doneAt !== null;
}
