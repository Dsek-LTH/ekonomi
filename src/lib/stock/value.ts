// Stock value by moving average cost. Value and quantity are stored, never a unit cost, so
// emptying a product takes its value to exactly zero (the last withdrawal takes what is left).

import type { StockEntryKind } from "@/lib/domain/types";

export interface Valued {
  qty: number;
  valueOre: number;
}

/** The quantity value rides on: whole unopened units. Opening a bottle drops it, so its cost leaves with it. */
export const costBasis = (amount: { units: number }): number => amount.units;

/**
 * What it costs to take `qtyOut` off a stock worth `held.valueOre`, returned positive.
 * Taking the whole lot takes the whole value to the öre, not the rounded share. Nothing held costs zero.
 */
export function costOfRemoval(held: Valued, qtyOut: number): number {
  if (qtyOut <= 0 || held.qty <= 0) return 0;
  if (qtyOut >= held.qty) return held.valueOre;
  return Math.round((held.valueOre * qtyOut) / held.qty);
}

/** Unit cost in öre for display only (a float on purpose). Calculations go through `costOfRemoval`. */
export const unitCostOre = (held: Valued): number | null =>
  held.qty > 0 ? held.valueOre / held.qty : null;

/**
 * What a delivery is worth: the unit cost copied off the product when the row is written, times units.
 * Zero when the product is unpriced.
 */
export function purchaseValueOre(units: number, unitCostOre: number | null | undefined): number {
  if (unitCostOre == null) return 0;
  return Math.round(unitCostOre * units);
}

/**
 * What one movement does to the stock's value, in öre. Used both by /api/stock/entries and by whole event sheets.
 *
 * A delivery is worth what was paid. Stock leaving takes the moving average at this moment.
 * Stock arriving takes the same average, or the product's cost when the shelf is empty (an
 * opening stocktake or a night that took it all), so arrivals are never booked at nothing.
 */
export function valueDelta(
  held: Valued,
  change: { kind: StockEntryKind; units: number; unitCostOre?: number | null },
): number {
  if (change.kind === "PURCHASE") return purchaseValueOre(change.units, change.unitCostOre);

  const qty = costBasis({ units: change.units });
  if (qty < 0) return -costOfRemoval(held, -qty);
  if (qty > 0) {
    return held.qty > 0
      ? Math.round((held.valueOre * qty) / held.qty)
      : purchaseValueOre(qty, change.unitCostOre);
  }
  return 0;
}

/**
 * Replays a product's value column from the beginning, since the moving average is order
 * dependent and editing a row changes every later withdrawal. Rows must be in written order.
 * Each row carries its own cost, so a price edit cannot re-price history.
 */
export function revalue(
  rows: readonly {
    id: string;
    kind: StockEntryKind;
    units: number;
    unitCostOre?: number | null;
  }[],
): Map<string, number> {
  const held: Valued = { qty: 0, valueOre: 0 };
  const out = new Map<string, number>();
  for (const row of rows) {
    const delta = valueDelta(held, {
      kind: row.kind,
      units: row.units,
      unitCostOre: row.unitCostOre,
    });
    held.qty += costBasis({ units: row.units });
    held.valueOre += delta;
    out.set(row.id, delta);
  }
  return out;
}
