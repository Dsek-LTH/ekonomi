// Delivery best-before checks. There is no real best-before on a crate, so this only
// prompts someone to go and look: shelfLifeMonths plus the delivery date.
// Pure over plain data.

import { addMonths, daysAgo, today } from "@/lib/domain/date";

/** `bestBefore` is captured when the row is written (see `bestBeforeOf`), so later re-dating cannot move it. */
export interface Delivery {
  id: string;
  /** `YYYY-MM-DD`. The day the stock arrived. */
  occurredAt: string;
  /** `YYYY-MM-DD`, or null on a product nobody has given a shelf life. */
  bestBefore: string | null;
  /** `YYYY-MM-DD`: when somebody last looked at it and said it was fine. */
  checkedAt: string | null;
}

/** Best-before for a delivery made today. Called once, when a PURCHASE row is written. Null when the product has no shelf life. */
export function bestBeforeOf(
  occurredAt: string,
  shelfLifeMonths: number | null | undefined,
): string | null {
  if (shelfLifeMonths == null || shelfLifeMonths <= 0) return null;
  return addMonths(occurredAt, shelfLifeMonths);
}

type CheckState = "over" | "soon" | "later";

export interface Check {
  entryId: string;
  occurredAt: string;
  bestBefore: string;
  state: CheckState;
  /** Negative once past. Whole days. */
  daysLeft: number;
  checkedAt: string | null;
  /** Whether the look still counts. `checkedAt` alone cannot say, and the product page needs both. */
  quiet: boolean;
}

/** Due, and not recently looked at. The overview flag and filter use this; the product page also lists what is coming. */
export const isDue = (check: Check): boolean => check.state !== "later" && !check.quiet;

/**
 * Null when the delivery can never raise a check: no date, or the stock is gone.
 * `emptiedAt` is the last day the shelf held nothing (see `lastEmptied`); deliveries on or before it are gone.
 */
export function checkOf(
  delivery: Delivery,
  leadDays: number,
  emptiedAt: string | null,
  now: string = today(),
): Check | null {
  const { bestBefore } = delivery;
  if (!bestBefore) return null;

  if (emptiedAt && delivery.occurredAt <= emptiedAt) return null;

  // `daysAgo` counts backwards, so negate it: positive while time is left.
  const daysLeft = -daysAgo(bestBefore, now);

  return {
    entryId: delivery.id,
    occurredAt: delivery.occurredAt,
    bestBefore,
    state: daysLeft < 0 ? "over" : daysLeft <= leadDays ? "soon" : "later",
    daysLeft,
    checkedAt: delivery.checkedAt,
    // Not silenced for good: the next check falls a lead time after the look.
    quiet: delivery.checkedAt != null && daysAgo(delivery.checkedAt, now) < leadDays,
  };
}

/** The oldest due check, so the overview shows one line per product. */
export function soonestCheck(checks: readonly Check[]): Check | null {
  let worst: Check | null = null;
  for (const check of checks) {
    if (!isDue(check)) continue;
    if (!worst || check.bestBefore < worst.bestBefore) worst = check;
  }
  return worst;
}

export interface ShelfStep {
  occurredAt: string;
  units: number;
  openUnits?: number;
}

/**
 * The last day the shelf held nothing at all, or null.
 * Read at the end of each day, since a delivery and the checkout that empties it can share a date.
 * Negative counts as empty.
 */
export function lastEmptied(steps: readonly ShelfStep[], opening = 0): string | null {
  const byDay = [...steps].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  // `opening` is the balance before the first step, so callers can skip older movements.
  let held = opening;
  let emptied: string | null = null;
  for (let i = 0; i < byDay.length; i++) {
    held += byDay[i].units + (byDay[i].openUnits ?? 0);
    const dayEnds = i + 1 === byDay.length || byDay[i + 1].occurredAt !== byDay[i].occurredAt;
    if (dayEnds && held <= 0) emptied = byDay[i].occurredAt;
  }
  return emptied;
}
