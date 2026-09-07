// Where a rental has got to, as the person running uthyrning sees it.
//
// Deliberately not ContractStatus. That says where the *agreement* stands
// (drafted, signed, terminated), which is what the archive is about. This says
// where the *gear* is, which is what somebody with a store room is about, and
// the two answer different questions on the same row: a signed contract can be
// upcoming, out, overdue or finished, and calling all four "Signerat" is what
// makes an archive useless as a work list.
//
// Derived rather than stored, the same reasoning as the expiry in status.ts. It
// is a fact about today, and a column would be quietly wrong every morning
// nobody ran a job.
import type { Tone } from "@/lib/domain/status";
import type { ContractStatus } from "@/lib/domain/types";

export type RentalState =
  /** Agreed but not handed over yet. */
  | "UPCOMING"
  /** With the renter, and not yet due back. */
  | "OUT"
  /** Due back and not returned. The one that needs somebody to do something. */
  | "OVERDUE"
  /** Back, but nobody has inspected and accepted it. The villkor's five-day
   *  window is running. */
  | "AWAITING_CHECK"
  /** Back and accepted. Nothing left to do. */
  | "CLOSED"
  /** The agreement never happened, or was ended. No gear is anywhere. */
  | "CANCELLED";

export interface RentalFacts {
  status: ContractStatus;
  /** ISO days. */
  pickupAt: string;
  returnAt: string;
  returnedAt: string | null;
  checkedAt: string | null;
}

/**
 * Where the gear is, as of `today`.
 *
 * Order matters here, and it is the order somebody would ask the questions in.
 * Cancelled first, because nothing else is true of a cancelled rental. Then
 * whether it has come back at all, because that decides between the two halves
 * of the list. Only then the dates.
 *
 * A returned-but-unchecked rental is its own state rather than "closed",
 * because that is exactly the gap the villkor turn on: the section has the gear
 * back and has not yet said whether it is undamaged, and the renter's liability
 * has not ended. See rental/terms.ts, punkt 2.
 */
export function rentalState(r: RentalFacts, today: string): RentalState {
  if (r.status === "CANCELLED" || r.status === "TERMINATED") return "CANCELLED";

  if (r.returnedAt !== null) {
    if (r.checkedAt === null) return "AWAITING_CHECK";
    return "CLOSED";
  }

  if (today < r.pickupAt) return "UPCOMING";
  // `returnAt` is the last day of the rental, so it is overdue from the day
  // after. Inclusive at both ends, the same reading the availability rule uses.
  if (today > r.returnAt) return "OVERDUE";
  return "OUT";
}

/**
 * The colour each state is drawn in.
 *
 * Only OVERDUE is danger. Everything else is a rental proceeding normally, and
 * a list where four of six states are red is a list nobody scans.
 */
export const RENTAL_STATE_TONE: Record<RentalState, Tone> = {
  UPCOMING: "neutral",
  OUT: "purple",
  OVERDUE: "danger",
  AWAITING_CHECK: "warning",
  CLOSED: "success",
  CANCELLED: "neutral",
};

/** The states, in the order a filter draws them. */
export const RENTAL_STATES: readonly RentalState[] = [
  "UPCOMING",
  "OUT",
  "OVERDUE",
  "AWAITING_CHECK",
  "CLOSED",
  "CANCELLED",
];

/**
 * The tabs the rentals list offers, as sets of states.
 *
 * "Att göra" is the tab this page exists for: what is late, and what is back
 * but not yet dealt with. Somebody opening Uthyrning on a Monday morning wants
 * that list and nothing else.
 */
export const RENTAL_TAB: Record<string, RentalState[] | undefined> = {
  todo: ["OVERDUE", "AWAITING_CHECK"],
  active: ["UPCOMING", "OUT", "OVERDUE"],
  "": undefined,
  closed: ["CLOSED", "CANCELLED"],
};

/** In the order the list draws them, "Att göra" first. */
export const RENTAL_TABS: readonly string[] = Object.keys(RENTAL_TAB);
