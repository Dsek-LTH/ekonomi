// What a night sold, from what left and what came back.
//
// An event groups the movements of one night, and once they are grouped the
// arithmetic is the whole of it:
//
//   sold = taken out − brought back − spilled
//
// There is no closing and no "sold" anybody types. That is the point of the
// event: a pub running past midnight is two dates, a committee may take stock
// out twice in an evening, and two events can share a night, so no date and no
// "the last checkout" can say which rows belong together, but an event can. Once
// they belong together the difference is not a guess.
//
// Everything here counts in the product's own unit: whole units for a can,
// millilitres for a spirit. Mixing the two would make "out − in" meaningless
// the first time a bottle went out full and came back half empty, which is most
// bottles.
//
// Signs matter, and that is newer than the rest of this file. A movement used
// to be folded in by its magnitude, because a checkout was always stored
// negative and a return always positive, so the sign carried no information the
// kind did not already have. The event sheet changed that: its cells hold the
// night's running total, and lowering one (a mistyped 1 200 that should have
// been 120) is written as a movement of the *same* kind pointing the other
// way. Fold that by its magnitude and the correction would add to the very
// figure it was meant to reduce. So each kind has a natural direction, and a
// movement counts along it.

import { LEVELS, isLevel, type OpenBottles } from "./levels";
import type { StockEntryKind, StockKind } from "@/lib/domain/types";

/** One entry of an event, as this file needs it. */
export interface TagMovement {
  kind: StockEntryKind;
  /** Whole units: cans, or sealed bottles. Signed as the log stores it. */
  units: number;
  /** Open bottles per rung. Signed as the log stores it. */
  open?: OpenBottles;
  /** How many things a spill destroyed: cans, or bottles. Signed. */
  spilledQty?: number;
  /** Which rung the row is about: 0 for a whole thing, or one of the four. */
  level?: number;
}

/** What the product is counted in, and how much a whole one holds. */
export interface TagSubject {
  kind: StockKind;
  /** Millilitres in one whole unit: a bottle or a can. */
  unitMl?: number | null;
  nominalMl?: number | null;
}

/**
 * What one whole thing at this rung holds, in the product's own unit.
 *
 * A can is one. A sealed bottle is its whole volume and a rung is a fraction of
 * it. Everything in this file and in cells.ts converts through here, so the
 * figure the sheet shows while somebody types and the figure the server stores
 * round the same way. Two roundings of the same quantity is how a total and
 * its parts come to disagree by a millilitre.
 */
export function levelVolume(product: TagSubject, level: number): number {
  if (product.kind !== "VOLUME") return 1;
  const whole = product.nominalMl ?? 0;
  if (level === 0) return whole;
  return isLevel(level) ? Math.round((whole * level) / 100) : 0;
}

/**
 * What one movement did, in the product's own unit, keeping the log's sign.
 *
 * For a can that is the count. For a spirit it is millilitres, because a bottle
 * leaving full and returning at 40 % is one bottle either way and 420 ml of
 * difference, the only unit in which "out minus in" says anything true.
 *
 * The sign is the one the shelf sees: negative took stock away, positive
 * brought it back. What each *kind* does with that is `tagTotals`' business.
 */
export function movementVolume(product: TagSubject, m: TagMovement): number {
  if (product.kind !== "VOLUME") return m.units;
  const open = LEVELS.reduce(
    (sum, level) => sum + (m.open?.[level] ?? 0) * levelVolume(product, level),
    0,
  );
  return m.units * levelVolume(product, 0) + open;
}

/**
 * What a spill cost, in the product's own unit.
 *
 * A dropped bottle loses everything left in it, so the rung it came off is the
 * whole of what it cost: one bottle at 40 % is 40 % of a bottle gone, and a
 * sealed one is all of it. A can is simply a can.
 */
export function spillVolume(product: TagSubject, m: TagMovement): number {
  const count = m.spilledQty ?? 0;
  if (product.kind !== "VOLUME" || count === 0) return count;
  return count * levelVolume(product, m.level ?? 0);
}

/** What an event comes to for one product. Every figure in the product's own unit. */
export interface TagTotals {
  out: number;
  back: number;
  spilled: number;
  /**
   * What is gone: taken out, less what came home and what was destroyed.
   *
   * Floored at nothing. A negative would mean more came back than ever left,
   * which the sheet refuses, and if one ever appears in stored data it is a
   * correction somebody made by hand, not a night that sold minus four cans.
   */
  sold: number;
}

/**
 * Fold an event's movements for one product.
 *
 * Each kind counts along its own direction, so a checkout of −120 reads as 120
 * out and a checkout of +120 (the sheet unwinding one) reads as 120 less. The
 * three running figures are therefore signed sums rather than magnitudes, and
 * only `sold` is floored.
 */
export function tagTotals(
  product: TagSubject,
  movements: readonly TagMovement[],
): TagTotals {
  let out = 0;
  let back = 0;
  let spilled = 0;
  for (const m of movements) {
    // A checkout is stored negative, so what went out is its opposite. A return
    // is stored positive and counts as it stands.
    if (m.kind === "CHECKOUT") out -= movementVolume(product, m);
    else if (m.kind === "RETURN") back += movementVolume(product, m);
    else if (m.kind === "WASTE") spilled += spillVolume(product, m);
  }
  return { out, back, spilled, sold: Math.max(0, out - back - spilled) };
}

/**
 * How much of what went out is still unaccounted for.
 *
 * The ceiling on a return and on a spill: you cannot bring home, or drop, more
 * than you took. While the night is running this is also what is still standing
 * on the bar, the same number the event calls sold, which is exactly the
 * ambiguity an event that is never closed accepts.
 */
export const unaccounted = (totals: TagTotals): number =>
  Math.max(0, totals.out - totals.back - totals.spilled);
