// Stock on hand and purchased volume, both by replaying the append-only StockEntry log.
// Pure over plain data.

import { LEVELS, openCount, openMl, type OpenBottles } from "./levels";
import type { DrinkCategory, StockEntryKind, StockKind } from "@/lib/domain/types";

/** One row of the log, as everything here needs it. */
export interface StockMovement {
  kind: StockEntryKind;
  /** Cans, or *sealed* bottles. */
  units: number;
  /** What it did to the open bottles at each level. VOLUME only. */
  open?: OpenBottles;
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
  /** Liquid in millilitres, sealed and open. Null when size is unknown. Open part is an estimate: display only. */
  totalMl: number | null;
  /** Worth in öre at moving average cost. Sealed bottles only: opening one is `units` falling. */
  valueOre: number;
}

/** How much one whole unit of this product holds, or null if nobody has said. */
export function unitVolume(p: StockSubject): number | null {
  const ml = p.kind === "VOLUME" ? p.nominalMl : p.unitMl;
  return ml != null && ml > 0 ? ml : null;
}

/** Replays a product's log. All kinds count, and row order does not matter (addition commutes). */
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
    // Sealed at whole volume plus the open ones' estimated content.
    totalMl: per == null ? null : units * per + (product.kind === "VOLUME" ? openMl(open, per) : 0),
    valueOre,
  };
}

/** Negative stock or open millilitres with no open bottle: a bookkeeping fault the overview flags. */
export function impossible(product: StockSubject, state: OnHand): boolean {
  if (state.units < 0) return true;
  if (product.kind !== "VOLUME") return false;
  return LEVELS.some((level) => (state.open[level] ?? 0) < 0);
}

/**
 * Millilitres bought, for the restaurangrapport's "inköpt volym". PURCHASE rows only.
 * Null for a product with no unit volume, so the gap is reported.
 */
export function purchasedMl(product: StockSubject, log: readonly StockMovement[]): number | null {
  const per = unitVolume(product);
  if (per == null) return null;
  return log.filter((m) => m.kind === "PURCHASE").reduce((sum, m) => sum + m.units * per, 0);
}

/** Litres of pure alcohol: volume × strength. Null when the ABV is unknown. */
export function pureAlcoholMl(product: StockSubject, ml: number): number | null {
  if (product.abv == null) return null;
  return Math.round((ml * product.abv) / 100);
}

/**
 * Centilitres of pure alcohol per krona (Systembolaget's comparison), from one unit's size and
 * cost price. Null when ABV, size or price is missing.
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
