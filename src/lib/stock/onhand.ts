// What is on the shelf, and what the year's report says was bought.
//
// Both are the same act: replaying the log. Nothing in this feature stores a
// quantity that anybody edits — `StockEntry` is append-only and every quantity
// on it is a signed delta, so on hand is their sum and the two can never drift
// apart. That is not tidiness, it is the point of a lagerbokföring: a stored
// number that can be changed is a number nobody can defend under inspection.
//
// Pure over plain data, so the rule the overview draws and the rule the report
// files are one rule, and both can be tested without a database.

import type { DrinkCategory, StockEntryKind, StockKind } from "@/lib/domain/types";

/** One row of the log, as everything here needs it. */
export interface StockMovement {
  kind: StockEntryKind;
  /** Whole units for a UNIT product; sealed bottles for a VOLUME one. */
  units: number;
  /** Millilitres in opened bottles. VOLUME only. */
  volumeMl: number;
  /** The change in how many bottles are open. VOLUME only. */
  openBottles: number;
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
  /** Cans, or sealed bottles. */
  units: number;
  /** How many bottles are open. VOLUME only; 0 for a UNIT product. */
  openBottles: number;
  /** Liquid in those open bottles. VOLUME only. */
  openMl: number;
  /**
   * Everything, in millilitres — sealed units at their nominal volume plus
   * what is in the open ones. Null when the product has never been told how
   * much a unit holds, because then no honest total exists.
   */
  totalMl: number | null;
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
 * the *report* separates, not what the shelf does — see `purchasedMl`.
 *
 * The order rows arrive in does not matter, and deliberately so. Addition
 * commutes, so a row entered late for an earlier date lands in the same total
 * as one entered on the day; nothing has to be re-run and no running balance
 * can fall out of step.
 */
export function onHand(product: StockSubject, log: readonly StockMovement[]): OnHand {
  let units = 0;
  let openBottles = 0;
  let openMl = 0;
  for (const m of log) {
    units += m.units;
    openBottles += m.openBottles;
    openMl += m.volumeMl;
  }

  const per = unitVolume(product);
  return {
    units,
    openBottles,
    openMl,
    totalMl: per == null ? null : units * per + openMl,
  };
}

/**
 * Whether a product's stock has gone somewhere it cannot be.
 *
 * Negative stock is always a bookkeeping fault rather than a fact — a delivery
 * nobody entered, a serving entered twice, a tare that is wrong — and the
 * overview says so rather than showing a minus sign and leaving it. Open
 * millilitres with no open bottle to hold them is the same class of fault, and
 * the one a mis-typed weighing produces.
 */
export function impossible(state: OnHand): boolean {
  return (
    state.units < 0 ||
    state.openBottles < 0 ||
    state.openMl < 0 ||
    (state.openBottles === 0 && state.openMl > 0)
  );
}

/** Below the level somebody set, and worth restocking. */
export const belowMinimum = (state: OnHand, minimum: number | null | undefined): boolean => {
  if (minimum == null) return false;
  const measured = state.totalMl ?? state.units;
  return measured < minimum;
};

/**
 * Millilitres bought in, for the restaurangrapport's "inköpt volym".
 *
 * PURCHASE rows only. What was served is turnover on that form, not a volume,
 * and what was spilled or found in a count is neither — so this cannot be
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
  return log
    .filter((m) => m.kind === "PURCHASE")
    .reduce((sum, m) => sum + m.units * per + m.volumeMl, 0);
}

/**
 * Whole litres, the way the report asks for them.
 *
 * Rounded rather than truncated: the form wants whole litres, and 4,6 litres is
 * better reported as 5 than as 4. Applied once to a category's total, never per
 * product, so a hundred small purchases do not each lose their fraction.
 */
export const wholeLitres = (ml: number): number => Math.round(ml / 1000);

/** Litres of pure alcohol — volume × strength. Null when the ABV is unknown. */
export function pureAlcoholMl(product: StockSubject, ml: number): number | null {
  if (product.abv == null) return null;
  return Math.round((ml * product.abv) / 100);
}

/**
 * The drink types the restaurangrapport wants a purchase volume for.
 *
 * Not every category: folköl and lättdrycker appear on the form under turnover
 * alone, and OVRIGT is ours — the wares and the glassware, which the form has
 * never heard of.
 */
export const REPORTED_CATEGORIES: readonly DrinkCategory[] = [
  "SPRITDRYCK",
  "VIN",
  "ANDRA_JASTA",
  "STARKOL",
  "ALKOHOLDRYCKSLIKNANDE",
];

export const isReportedCategory = (c: DrinkCategory): boolean =>
  REPORTED_CATEGORIES.includes(c);
