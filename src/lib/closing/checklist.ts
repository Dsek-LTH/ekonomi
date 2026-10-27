// The rules of the bokslut checklist that are not about the database: when an
// item is due, and whether it is done.
import type { ClosingCheck } from "@/lib/domain/types";

/** Every check the app can answer, in the order the template editor lists them. */
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

/** What a check found: how much is left, and where to go to deal with it. */
export interface CheckResult {
  remaining: number;
  href: string | null;
}

/** The day an item is due: `offset` days from the year's last day. */
export function dueDateFor(yearEnd: string, offset: number | null): string | null {
  if (offset === null) return null;
  const d = new Date(`${yearEnd}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

/**
 * Whether an item is done. One with a check is done when the check finds
 * nothing left, whatever anybody ticked; one without is done when it was ticked.
 */
export function isItemDone(item: { doneAt: string | null; check: CheckResult | null }): boolean {
  return item.check ? item.check.remaining === 0 : item.doneAt !== null;
}
