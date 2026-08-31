// Reading a product's log forward, so that what a stocktake says stays true.
//
// Two things in the log are not simply what somebody typed. Both have to be
// worked out from everything before them, and both therefore have to be worked
// out again whenever anything before them changes.
//
// A stocktake states what was on the shelf. It is stored as the difference
// between that and what the books expected, because the log is a log of
// differences, but the *statement* is the absolute. Leave the difference alone
// when an earlier delivery is corrected and the count silently stops holding:
// the books said 100, you counted 90, the row says −10, and someone fixing that
// delivery down by 80 leaves the shelf reading 10. You counted 90. Re-deriving
// the difference is what makes an inventering mean what everybody already
// thinks it means: at this date the stock was this, and that is the baseline.
//
// And cost of goods rides on a moving average, so what a bottle cost to take
// out depends on what the shelf was worth at that moment. A delivery that
// changes size changes what every withdrawal after it cost.
//
// Hence: order matters here and nowhere else. `onHand` is still a plain sum
// over the log and still order-independent. This runs first and leaves the
// stored rows in a state where that sum is right.

import { LEVELS, type Level, type OpenBottles } from "./levels";
import { costBasis, valueDelta, type Valued } from "./value";
import type { StockEntryKind } from "@/lib/domain/types";

/** A row of one product's log, in the order it happened. */
export interface ReplayRow {
  id: string;
  kind: StockEntryKind;
  /** 0 for a whole thing, or the rung. */
  level: number;
  units: number;
  open: OpenBottles;
  /**
   * On a stocktake: what was actually counted at this rung.
   *
   * Null on everything else, and on stocktakes written before the count became
   * a statement rather than a difference. Those keep the difference they were
   * given, because nothing recorded what they were counting.
   */
  countedQty?: number | null;
  valueDeltaOre: number;
}

/** What a row should hold once the log has been read forward. */
export interface Settled {
  units: number;
  open: OpenBottles;
  valueDeltaOre: number;
}

export const differs = (row: ReplayRow, want: Settled): boolean =>
  row.units !== want.units ||
  row.valueDeltaOre !== want.valueDeltaOre ||
  LEVELS.some((l) => (row.open[l] ?? 0) !== (want.open[l] ?? 0));

/**
 * Work out what every row of a product's log should hold.
 *
 * `rows` in the order they happened: by the day they happened, then by the
 * order they were written, which is the only tiebreak that is stable.
 */
export function replay(
  rows: readonly ReplayRow[],
  costPriceOre: number | null | undefined,
): Map<string, Settled> {
  /** What the shelf holds as the log is walked. Index 0 is whole things. */
  const running: Record<number, number> = { 0: 0, 80: 0, 60: 0, 40: 0, 20: 0 };
  const held: Valued = { qty: 0, valueOre: 0 };
  const out = new Map<string, Settled>();

  for (const row of rows) {
    let units = row.units;
    let open: OpenBottles = { ...row.open };

    // A count is a statement about the shelf, so its difference is whatever
    // gets the books to it, recomputed here rather than frozen at the moment
    // somebody counted.
    if (row.kind === "COUNT" && row.countedQty != null) {
      const diff = row.countedQty - (running[row.level] ?? 0);
      if (row.level === 0) {
        units = diff;
        open = {};
      } else {
        units = 0;
        open = { [row.level as Level]: diff };
      }
    }

    running[0] += units;
    for (const level of LEVELS) running[level] += open[level] ?? 0;

    const delta = valueDelta(held, { kind: row.kind, units, costPriceOre });
    held.qty += costBasis({ units });
    held.valueOre += delta;

    out.set(row.id, { units, open, valueDeltaOre: delta });
  }
  return out;
}
