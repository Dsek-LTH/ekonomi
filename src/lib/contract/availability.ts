// Whether the gear is free: stops one item being promised to two people. Pure, takes
// existing bookings as an argument (the query is lib/data/rental-availability.ts).

/** A day, as an ISO string. Compared lexically, which ISO days allow. */
type Day = string;

export interface Booking {
  itemId: string;
  quantity: number;
  /** Inclusive, both ends. */
  from: Day;
  to: Day;
}

export interface Request {
  itemId: string;
  quantity: number;
}

export interface Shortfall {
  itemId: string;
  owned: number;
  booked: number;
  wanted: number;
}

/** Whether two inclusive day ranges touch. Same-day handovers count as a clash, on purpose. */
export const overlaps = (a: { from: Day; to: Day }, b: { from: Day; to: Day }): boolean =>
  a.from <= b.to && b.from <= a.to;

/** What is already spoken for per item over one period. Quantities are summed, not counted. */
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
 * Items the section cannot cover over the period (empty means it fits). Requests for the
 * same item are summed. Items missing from the catalogue (free text) are never a shortfall.
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

/** How many of each catalogue item are free over the period, never below zero. */
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
