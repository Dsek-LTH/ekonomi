// What is on the shelf, and what the year's report says was bought.
//
// Both are the same act: replaying the log. Nothing in this feature stores a
// quantity that anybody edits. `StockEntry` is append-only and every quantity
// on it is a signed delta, so on hand is their sum and the two can never drift
// apart. That is not tidiness, it is the point of a lagerbokföring: a stored
// number that can be changed is a number nobody can defend under inspection.
//
// Pure over plain data, so the rule the overview draws and the rule the report
// files are one rule, and both can be tested without a database.

import { LEVELS, openCount, openMl, type OpenBottles } from "./levels";
import type { DrinkCategory, StockEntryKind, StockKind } from "@/lib/domain/types";

/** One row of the log, as everything here needs it. */
export interface StockMovement {
  kind: StockEntryKind;
  /** Cans, or *sealed* bottles. */
  units: number;
  /** What it did to the open bottles at each level. VOLUME only. */
  open?: OpenBottles;
  /** What it did to the stock's value, in öre. See lib/stock/value.ts. */
  valueDeltaOre?: number;
}

/** What a product is, as far as counting it goes. */
export interface StockSubject {
  kind: StockKind;
  category: DrinkCategory;
  /** UNIT: what one unit holds. VOLUME: what one sealed bottle holds. */
  unitMl?: number | null;
  nominalMl?: number | null;
  abv?: number | null;
}

/** What is on the shelf, in every unit anybody asks for it in. */
export interface OnHand {
  /** Cans, or *sealed* bottles: the ones still worth their purchase price. */
  units: number;
  /** Open bottles, per level. Empty for a UNIT product. */
  open: OpenBottles;
  /** How many bottles are open at all. */
  openBottles: number;
  /**
   * Liquid, in millilitres, sealed and open together.
   *
   * Null when nobody has said how much one holds. For a spirit the open part is
   * an estimate stacked on estimates, four rungs of a ladder somebody eyeballs,
   * so it is a figure for a screen and never for a valuation.
   */
  totalMl: number | null;
  /**
   * What it is worth, in öre, at moving average cost.
   *
   * Sealed bottles only. An opened bottle is written off the moment it is
   * opened, which needs no rule of its own: value rides on `units`, and opening
   * a bottle is `units` falling with no purchase behind it.
   */
  valueOre: number;
}

/** How much one whole unit of this product holds, or null if nobody has said. */
export function unitVolume(p: StockSubject): number | null {
  const ml = p.kind === "VOLUME" ? p.nominalMl : p.unitMl;
  return ml != null && ml > 0 ? ml : null;
}

/**
 * Replay a product's log.
 *
 * Every kind of entry counts the same here, including CORRECTION and COUNT: a
 * correction is a real movement of the recorded stock, and a count's difference
 * is exactly what the shelf had that the log did not know about. Kinds are what
 * the *report* separates, not what the shelf does. See `purchasedMl`.
 *
 * The order rows arrive in does not matter, and deliberately so. Addition
 * commutes, so a row entered late for an earlier date lands in the same total
 * as one entered on the day; nothing has to be re-run and no running balance
 * can fall out of step.
 */
export function onHand(product: StockSubject, log: readonly StockMovement[]): OnHand {
  let units = 0;
  let valueOre = 0;
  const open: OpenBottles = {};
  for (const m of log) {
    units += m.units;
    valueOre += m.valueDeltaOre ?? 0;
    if (m.open) {
      for (const level of LEVELS) {
        const n = m.open[level] ?? 0;
        if (n !== 0) open[level] = (open[level] ?? 0) + n;
      }
    }
  }

  const per = unitVolume(product);
  return {
    units,
    open,
    openBottles: openCount(open),
    // Sealed bottles at their whole volume plus whatever the open ones are
    // judged to hold. A can has no open state, so its litres are just the
    // count.
    totalMl: per == null ? null : units * per + (product.kind === "VOLUME" ? openMl(open, per) : 0),
    valueOre,
  };
}

/**
 * Whether a product's stock has gone somewhere it cannot be.
 *
 * Negative stock is always a bookkeeping fault rather than a fact (a delivery
 * nobody entered, a serving entered twice, a tare that is wrong) and the
 * overview says so rather than showing a minus sign and leaving it. Open
 * millilitres with no open bottle to hold them is the same class of fault, and
 * the one a mis-typed weighing produces.
 */
export function impossible(product: StockSubject, state: OnHand): boolean {
  if (state.units < 0) return true;
  if (product.kind !== "VOLUME") return false;
  // A negative count of open bottles at any rung: a bottle taken out that the
  // log never saw arrive, or a level picked that was not there.
  return LEVELS.some((level) => (state.open[level] ?? 0) < 0);
}

/**
 * Millilitres bought in, for the restaurangrapport's "inköpt volym".
 *
 * PURCHASE rows only. What was served is turnover on that form, not a volume,
 * and what was spilled or found in a count is neither, so this cannot be
 * derived from the on-hand figure, which is why the kinds are kept apart in the
 * first place.
 *
 * Returns null for a product with no unit volume, so a caller reports the gap
 * rather than filing a total that quietly omitted it.
 */
export function purchasedMl(
  product: StockSubject,
  log: readonly StockMovement[],
): number | null {
  const per = unitVolume(product);
  if (per == null) return null;
  // Sealed units only, and everything bought is sealed. A delivery of opened
  // bottles is not a thing. So the litres bought are the count times the size,
  // for a spirit exactly as for a can.
  return log
    .filter((m) => m.kind === "PURCHASE")
    .reduce((sum, m) => sum + m.units * per, 0);
}


/** Litres of pure alcohol: volume × strength. Null when the ABV is unknown. */
export function pureAlcoholMl(product: StockSubject, ml: number): number | null {
  if (product.abv == null) return null;
  return Math.round((ml * product.abv) / 100);
}

/**
 * How much of a krona spent on this product is pure alcohol, in centilitres.
 *
 * Systembolaget's own way of putting two different drinks on the same
 * footing: a strong, cheap spirit and a weak, pricey lager can share a shelf
 * price and still not be worth the same thing to drink. Worked out from one
 * whole unit's own size and cost price, never from what is left on the
 * shelf, so a product with nothing in stock still has an answer, and for
 * showing only, the same rule as `unitCostOre` in lib/stock/value.ts.
 *
 * Null when the ABV, the size or the cost price is missing, or the price is
 * zero: a ratio against nothing is not a number, and a gap should show as a
 * gap rather than as a division by it.
 */
export function alcoholPerKrona(
  product: StockSubject & { costPriceOre?: number | null },
): number | null {
  if (!product.costPriceOre) return null;
  const ml = unitVolume(product);
  if (ml == null) return null;
  const alcoholMl = pureAlcoholMl(product, ml);
  if (alcoholMl == null) return null;
  return alcoholMl / 10 / (product.costPriceOre / 100);
}
