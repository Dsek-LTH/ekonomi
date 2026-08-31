// What the stock is worth, by moving average cost.
//
// Simpler than FIFO, accepted for valuing a varulager, and the only method a
// student guild will actually keep up. What it needs is one rule applied on the
// way in and on the way out, and one property nobody notices until it is
// missing: emptying a product has to take its value to *exactly* zero.
//
// The trick that makes that hold is storing the value and the quantity, never a
// unit cost. Spirit at 149 400 öre for 4 200 ml is 35,5714 öre/ml, and an
// integer column cannot hold that. Round it once and every withdrawal
// afterwards is wrong in the same direction, until the shelf is empty and the
// books still show forty kronor of vodka that is not there.
//
// So the unit cost is never stored. It is worked out from the two sums at the
// moment of a withdrawal, and the last withdrawal takes whatever is left.

import type { StockEntryKind } from "@/lib/domain/types";

/** What the log says a product holds, and what it is worth. */
export interface Valued {
  /** The quantity value is carried by. See `costBasis`. */
  qty: number;
  /** What that quantity cost, in öre. */
  valueOre: number;
}

/**
 * The quantity a product's value rides on: whole, unopened units.
 *
 * Cans for one kind of product and sealed bottles for the other, and the same
 * arithmetic for both. An opened bottle is worth nothing to the stock. The bar
 * values what it could still sell as a bottle, so the moment one is opened its
 * cost leaves, with no rule needed to make that happen: the sealed count falls
 * and the value goes with it.
 */
export const costBasis = (amount: { units: number }): number => amount.units;

/**
 * What it costs to take `qtyOut` off a stock worth `held.valueOre`.
 *
 * Returned positive; the caller writes it as a negative delta.
 *
 * Three cases, and the third is the one worth having:
 *
 *   nothing held      zero. A withdrawal from an empty stock is a mistake
 *                       somewhere else, and inventing a cost for it would hide
 *                       that behind a plausible number.
 *   the whole lot     the whole value, to the öre. Not the rounded share,
 *                       which would leave a few öre of a product nobody has.
 *   part of it        the proportional share, rounded once.
 */
export function costOfRemoval(held: Valued, qtyOut: number): number {
  if (qtyOut <= 0 || held.qty <= 0) return 0;
  if (qtyOut >= held.qty) return held.valueOre;
  return Math.round((held.valueOre * qtyOut) / held.qty);
}

/**
 * The unit cost, in öre, for showing, never for calculating with.
 *
 * Every arithmetic path goes through `costOfRemoval`, which divides once at the
 * point of use. This is the same number rendered for a human, and it is a float
 * on purpose: a spirit really does cost 35,5714 öre per millilitre, and
 * printing 36 would be a lie about a figure somebody may be checking.
 */
export const unitCostOre = (held: Valued): number | null =>
  held.qty > 0 ? held.valueOre / held.qty : null;

/**
 * What a delivery is worth.
 *
 * The product's recorded unit cost times the units, and nothing else. The price
 * belongs to the product rather than to the movement: it is the same number for
 * every delivery of it, and asking for it again on each one is asking somebody
 * standing in a cellar with a crate to remember what a bottle costs.
 *
 * Zero when nobody has priced the product. A gap that shows up as a gap, a
 * shelf worth nothing when it plainly is not, rather than a total quietly
 * built on a guess. The register form says so before the row is written.
 */
export function purchaseValueOre(
  units: number,
  costPriceOre: number | null | undefined,
): number {
  if (costPriceOre == null) return 0;
  return Math.round(costPriceOre * units);
}

/**
 * What one movement does to the stock's value, in öre.
 *
 * The whole of the moving-average rule in one place, because two callers apply
 * it: a single movement through /api/stock/entries, and a whole event sheet at
 * once, and two copies of a valuation rule is how a shelf ends up worth two
 * different amounts depending on which screen wrote to it.
 *
 * Three cases:
 *
 *   a delivery      what was paid, from the product's own cost price. The
 *                     price belongs to the product, not to the movement.
 *   stock leaving   the moving average at this moment, computed once and
 *                     never recomputed: the average moves with the next
 *                     delivery, and a figure worked out later would not be what
 *                     this movement was worth.
 *   stock arriving  the same average, applied the other way. Sealed bottles
 *                     turning up without a purchase behind them are a return of
 *                     what went out unopened or a count finding one the log had
 *                     lost, and pricing them at nothing would let a night out
 *                     quietly write the stock down.
 *
 * That third case has an empty shelf under it, and the average of an empty
 * shelf is not a number. It used to answer zero there, which was the same
 * write-down it exists to prevent, only worse, because the two ways of reaching
 * it are the two that matter most:
 *
 *   the opening stocktake   a cellar counted onto the shelf for the first time
 *                             has no delivery behind it, so every bottle in the
 *                             building was booked in at nothing.
 *   a night that took it all  everything out to a pub leaves the shelf at zero,
 *                             and what came home unopened arrived worth nothing.
 *
 * So an arrival onto an empty shelf is priced from the product's own cost, the
 * same figure a delivery of it would carry. It is what the bottle cost, which
 * is the only defensible answer, and where nobody has priced the product it is
 * still nothing, which is the gap showing as a gap.
 */
export function valueDelta(
  held: Valued,
  change: { kind: StockEntryKind; units: number; costPriceOre?: number | null },
): number {
  if (change.kind === "PURCHASE") return purchaseValueOre(change.units, change.costPriceOre);

  const qty = costBasis({ units: change.units });
  if (qty < 0) return -costOfRemoval(held, -qty);
  if (qty > 0) {
    return held.qty > 0
      ? Math.round((held.valueOre * qty) / held.qty)
      : purchaseValueOre(qty, change.costPriceOre);
  }
  return 0;
}

/**
 * Work out a product's whole value column again, from the beginning.
 *
 * Needed because rows can now be edited. A moving average is order-dependent.
 * what a bottle cost to take out depends on what the shelf was worth at that
 * moment, so changing a delivery from 200 bottles to 20 changes what every
 * withdrawal after it cost. Leaving those alone would leave the stock valued
 * against a delivery that never happened.
 *
 * So the column is replayed rather than patched. Rows in the order they were
 * written; out comes the value each one should carry. Cheap enough to do on
 * every edit: it is one product, and a guild's product has tens of rows.
 *
 * The figures it produces are not the ones that were computed at the time, and
 * that is the point. They are the ones that would have been computed if the
 * corrected figure had been right all along, which is what a correction means.
 */
export function revalue(
  rows: readonly { id: string; kind: StockEntryKind; units: number }[],
  costPriceOre: number | null | undefined,
): Map<string, number> {
  const held: Valued = { qty: 0, valueOre: 0 };
  const out = new Map<string, number>();
  for (const row of rows) {
    const delta = valueDelta(held, { kind: row.kind, units: row.units, costPriceOre });
    held.qty += costBasis({ units: row.units });
    held.valueOre += delta;
    out.set(row.id, delta);
  }
  return out;
}
