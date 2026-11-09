// Where a rental has got to (the gear), as opposed to ContractStatus (the agreement).
// Derived, never stored, since it is a fact about today.
import type { Tone } from "@/lib/domain/status";

export type RentalState =
  | "UPCOMING"
  | "OUT"
  | "OVERDUE"
  /** Back, but not yet inspected and accepted (the villkor's five-day window is running). */
  | "AWAITING_CHECK"
  | "CLOSED";

export interface RentalFacts {
  pickupAt: string;
  returnAt: string;
  returnedAt: string | null;
  checkedAt: string | null;
}

/**
 * Where the gear is, as of `today`. Returned-or-not decides first, then the dates. A
 * returned-but-unchecked rental is its own state because damage reported within five
 * working days is still presumed the renter's (rental/terms.ts, § 3).
 */
export function rentalState(r: RentalFacts, today: string): RentalState {
  if (r.returnedAt !== null) {
    if (r.checkedAt === null) return "AWAITING_CHECK";
    return "CLOSED";
  }

  if (today < r.pickupAt) return "UPCOMING";
  // `returnAt` is the last day, so overdue starts the day after (inclusive, like availability).
  if (today > r.returnAt) return "OVERDUE";
  return "OUT";
}

/** The colour each state is drawn in. Only OVERDUE is danger. */
export const RENTAL_STATE_TONE: Record<RentalState, Tone> = {
  UPCOMING: "neutral",
  OUT: "purple",
  OVERDUE: "danger",
  AWAITING_CHECK: "warning",
  CLOSED: "success",
};

/** The tabs the rentals list offers, as sets of states. Each key is a label: rentals.tab.todo, .active, .closed (and .all for ""). */
export const RENTAL_TAB: Record<string, RentalState[] | undefined> = {
  todo: ["OVERDUE", "AWAITING_CHECK"],
  active: ["UPCOMING", "OUT", "OVERDUE"],
  "": undefined,
  closed: ["CLOSED"],
};

export const RENTAL_TABS: readonly string[] = Object.keys(RENTAL_TAB);
