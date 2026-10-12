// Whether the gear is free.
//
// The rule that stops the app promising one Soundboks to two people on the same
// Saturday. Worth stating plainly, because digitising the contract without this
// would make that mistake *more* likely than the paper process it replaced: on
// paper one person wrote the uthyrningsavtal and remembered, and here anyone
// with CONTRACT_MANAGE can draw one in thirty seconds against a system that
// knows nothing.
//
// Pure, and takes the existing bookings as an argument rather than fetching
// them, so the arithmetic can be asserted on without a database. The query that
// gathers them is lib/data/rental-availability.ts.

/** A day, as an ISO string. Compared lexically, which ISO days allow. */
type Day = string;

/** One item held by one contract over one period. */
export interface Booking {
  itemId: string;
  quantity: number;
  /** Inclusive, both ends. */
  from: Day;
  to: Day;
}

/** What is being asked for. */
export interface Request {
  itemId: string;
  quantity: number;
}

export interface Shortfall {
  itemId: string;
  /** How many the section owns. */
  owned: number;
  /** How many are already spoken for over the requested period. */
  booked: number;
  /** How many this request wants. */
  wanted: number;
}

/**
 * Whether two inclusive day ranges touch.
 *
 * Inclusive at both ends, so a contract ending on the 5th and one starting on
 * the 5th are treated as a clash. That is deliberate and it is the conservative
 * reading: the gear is due back at some unstated hour of the 5th and due out
 * again at some other unstated hour, and a system that says "fine" is
 * volunteering an assumption about the afternoon that nobody made. Whoever
 * knows the two handovers really do fit can move a date by a day.
 */
export const overlaps = (a: { from: Day; to: Day }, b: { from: Day; to: Day }): boolean =>
  a.from <= b.to && b.from <= a.to;

/**
 * What is already spoken for, per item, over one period.
 *
 * Quantities are summed rather than counted: the section owns four microphone
 * stands, so two contracts taking two each is fine and a third taking one is
 * not. A boolean "is it out" could not tell those apart.
 */
export function bookedOver(
  bookings: readonly Booking[],
  period: { from: Day; to: Day },
): Map<string, number> {
  const out = new Map<string, number>();
  for (const b of bookings) {
    if (!overlaps(b, period)) continue;
    out.set(b.itemId, (out.get(b.itemId) ?? 0) + b.quantity);
  }
  return out;
}

/**
 * Which of the requested items the section cannot cover over the period.
 *
 * An empty array means the whole request fits. Requests for the same item are
 * added together first, so a form that lists the Soundboks on two lines is
 * asking for two of them, which is what it looks like it is asking for.
 *
 * An item with no catalogue row is not a shortfall. A rental line is allowed to
 * be free text (somebody lends out a thing the catalogue has never heard of),
 * and refusing that would make the catalogue compulsory, which it is not.
 */
export function shortfalls(args: {
  requests: readonly Request[];
  owned: ReadonlyMap<string, number>;
  bookings: readonly Booking[];
  period: { from: Day; to: Day };
}): Shortfall[] {
  const { requests, owned, bookings, period } = args;

  const wanted = new Map<string, number>();
  for (const r of requests) {
    wanted.set(r.itemId, (wanted.get(r.itemId) ?? 0) + r.quantity);
  }

  const booked = bookedOver(bookings, period);

  const out: Shortfall[] = [];
  for (const [itemId, want] of wanted) {
    const have = owned.get(itemId);
    if (have === undefined) continue; // free text, not a catalogue item
    const taken = booked.get(itemId) ?? 0;
    if (taken + want > have) {
      out.push({ itemId, owned: have, booked: taken, wanted: want });
    }
  }
  return out;
}

/**
 * How many of each catalogue item are free over the period.
 *
 * What the form draws beside each option. Never below zero: an item that is
 * somehow over-booked already (a quantity lowered after the contracts were
 * drawn) reads as "none free", which is the useful answer, rather than as a
 * negative number, which is a puzzle.
 */
export function freeOver(args: {
  owned: ReadonlyMap<string, number>;
  bookings: readonly Booking[];
  period: { from: Day; to: Day };
}): Map<string, number> {
  const booked = bookedOver(args.bookings, args.period);
  const out = new Map<string, number>();
  for (const [itemId, have] of args.owned) {
    out.set(itemId, Math.max(0, have - (booked.get(itemId) ?? 0)));
  }
  return out;
}
