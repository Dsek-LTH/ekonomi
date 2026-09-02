// Which deliveries are worth going and looking at.
//
// The cellar writes nothing on a crate. Crates of the same beer get stacked
// together, and they come off the shelf in whatever order somebody reaches, so
// no allocation of what is on hand back onto deliveries would be true. Any
// system that claimed to know a real best-before date here would be inventing
// one.
//
// So this claims nothing of the sort. It knows two things, and neither is a
// guess: a lager keeps about nine months (StockProduct.shelfLifeMonths) and a
// delivery arrived on a day (StockEntry.occurredAt). Together they say "a
// delivery from March is worth looking at before Christmas", which is a prompt
// to go and read a crate rather than a statement about what is in the cellar.
// The whole feature is that sentence.
//
// Three things end a check, and the first is what keeps the list readable. A
// product bought monthly for three years has thirty-six deliveries, and
// thirty-five of them are about beer that was drunk long ago.
//
//   the shelf went empty   Definitely gone. Not an assumption: if on hand
//                            reached nothing after a delivery, none of it is
//                            down there. Clears most of the list on its own,
//                            for anything that sells through.
//   somebody looked        `checkedAt`, per delivery, because each of these is
//                            a task somebody works through rather than a fact
//                            about the shelf. Pushes the next check out by the
//                            lead time rather than silencing it, because a
//                            crate looked at in December wants looking at
//                            again.
//   it was written off     A SPOILAGE takes the stock off the shelf, and if
//                            that empties it the first rule applies.
//
// Pure over plain data, like the rest of lib/stock. The screen that draws the
// flag and the query that counts them are one rule.

import { addMonths, daysAgo, today } from "@/lib/domain/date";

/** How much notice to give, when nothing has been configured. */
export const DEFAULT_LEAD_DAYS = 30;

/**
 * A delivery, as this file needs it.
 *
 * `bestBefore` is already resolved: it was worked out and captured when the row
 * was written, so a product re-priced or re-dated since cannot move it. See the
 * column's note in the schema, and `bestBeforeOf` below, which is what wrote it.
 */
export interface Delivery {
  id: string;
  /** `YYYY-MM-DD`. The day the stock arrived. */
  occurredAt: string;
  /** `YYYY-MM-DD`, or null on a product nobody has given a shelf life. */
  bestBefore: string | null;
  /** `YYYY-MM-DD`: when somebody last looked at it and said it was fine. */
  checkedAt: string | null;
}

/**
 * When a delivery made today stops being worth drinking.
 *
 * The one place the estimate is made, called when a PURCHASE row is written and
 * never again. Null where the product has no shelf life, which is how a product
 * that does not go off (a spirit) stays out of this entirely.
 */
export function bestBeforeOf(
  occurredAt: string,
  shelfLifeMonths: number | null | undefined,
): string | null {
  if (shelfLifeMonths == null || shelfLifeMonths <= 0) return null;
  return addMonths(occurredAt, shelfLifeMonths);
}

/** Where a delivery stands against its own estimated date. */
export type CheckState =
  /** Past it. */
  | "over"
  /** Inside the lead time, still ahead of it. */
  | "soon"
  /** Beyond the lead time. Not something to do, but something coming. */
  | "later";

/** One delivery, and what its date says about it. */
export interface Check {
  entryId: string;
  occurredAt: string;
  bestBefore: string;
  state: CheckState;
  /** Negative once it is past. Whole days, so a clock change cannot shift it. */
  daysLeft: number;
  /** When somebody last looked at this delivery and said it was fine. */
  checkedAt: string | null;
  /**
   * Whether that look still counts.
   *
   * Separate from `checkedAt` because the two answer different questions. The
   * product page shows every check a delivery will raise, dismissed ones
   * included, so it needs to say "looked at on the 3rd" and "not asking about
   * this yet" independently.
   */
  quiet: boolean;
}

/**
 * Whether this is something to do now.
 *
 * Due, and not recently looked at. What the overview's flag and its filter both
 * ask. The product page deliberately does not: it lists what is coming as well
 * as what is owed, which is what makes it a schedule rather than a second copy
 * of the flag.
 */
export const isDue = (check: Check): boolean => check.state !== "later" && !check.quiet;

/**
 * What a delivery's date says about it, or null where it says nothing at all.
 *
 * Null means the delivery can never raise a check: it carries no date, or the
 * stock is definitely gone. Everything else comes back with a state, including
 * dates months away and deliveries somebody has already looked at, because the
 * product page lists what is coming and not only what is owed. Whether a check
 * is something to *do* is `isDue`, one question further on.
 *
 * `emptiedAt` is the last day the product's shelf held nothing at all, or null
 * if it never has. Everything delivered on or before it is gone, whatever its
 * date says, and that is a fact from the log rather than an assumption about
 * who reached for which crate. See `lastEmptied`.
 */
export function checkOf(
  delivery: Delivery,
  leadDays: number,
  emptiedAt: string | null,
  now: string = today(),
): Check | null {
  const { bestBefore } = delivery;
  if (!bestBefore) return null;

  // Drunk. A delivery cannot want checking when the shelf it went onto has
  // since been empty, and it has nothing to say on a page about it either.
  if (emptiedAt && delivery.occurredAt <= emptiedAt) return null;

  // `daysAgo` counts backwards, so a date still to come is negative and this is
  // its mirror: positive while there is time left.
  const daysLeft = -daysAgo(bestBefore, now);

  return {
    entryId: delivery.id,
    occurredAt: delivery.occurredAt,
    bestBefore,
    state: daysLeft < 0 ? "over" : daysLeft <= leadDays ? "soon" : "later",
    daysLeft,
    checkedAt: delivery.checkedAt,
    // Looked at recently enough. Not silenced for good: the next check falls a
    // lead time after the look, so a crate seen in December comes back in
    // January. It is still a crate, and it is a month closer to the date.
    quiet: delivery.checkedAt != null && daysAgo(delivery.checkedAt, now) < leadDays,
  };
}

/**
 * The one check the overview shows, out of however many deliveries a product
 * has.
 *
 * The oldest that is actually due, because that is the one somebody is going to
 * find at the back of the shelf. Thirty-six reminders about the same lager is
 * one line on a list and thirty-six ways to stop reading it. The product's own
 * page is where all of them are, which is the right place for them: there they
 * are a schedule for one thing rather than noise across everything.
 */
export function soonestCheck(checks: readonly Check[]): Check | null {
  let worst: Check | null = null;
  for (const check of checks) {
    if (!isDue(check)) continue;
    if (!worst || check.bestBefore < worst.bestBefore) worst = check;
  }
  return worst;
}

/** One movement, as the emptiness walk needs it. */
export interface ShelfStep {
  /** `YYYY-MM-DD`. */
  occurredAt: string;
  /** What it did to the sealed count. */
  units: number;
  /** What it did to the open bottles, summed across the rungs. */
  openUnits?: number;
}

/**
 * The last day the shelf held nothing at all, or null if it never has.
 *
 * The rule that makes this feature usable rather than a list nobody can clear,
 * and the only one of the three that costs nothing to keep up. A product that
 * runs out between deliveries clears its own history every time it does.
 *
 * Walked in date order and read at the end of each day rather than after each
 * row, because a delivery and the checkout that empties it can share a date and
 * be written in either order. What matters is whether the shelf was ever empty
 * when the day was over, which is the only reading somebody standing in the
 * cellar would recognise.
 *
 * Nothing is floored. A product whose log has gone negative is a bookkeeping
 * fault (`impossible` in onhand.ts says so on the same screen), and treating
 * negative as empty is right either way: there is certainly nothing down there.
 */
export function lastEmptied(steps: readonly ShelfStep[]): string | null {
  const byDay = [...steps].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  let held = 0;
  let emptied: string | null = null;
  for (let i = 0; i < byDay.length; i++) {
    held += byDay[i].units + (byDay[i].openUnits ?? 0);
    const dayEnds = i + 1 === byDay.length || byDay[i + 1].occurredAt !== byDay[i].occurredAt;
    if (dayEnds && held <= 0) emptied = byDay[i].occurredAt;
  }
  return emptied;
}
