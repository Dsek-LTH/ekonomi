// Reads a product's log forward. A stocktake is stored as a difference but states an absolute,
// and costs ride on a moving average, so both must be recomputed when anything earlier changes.
// Order matters here only; `onHand` stays a plain order-independent sum.

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
  /** On a stocktake: what was counted at this rung. Null on older stocktakes, which keep their difference. */
  countedQty?: number | null;
  valueDeltaOre: number;
  /** What a unit cost when this row was written. */
  unitCostOre?: number | null;
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

/** `rows` in order: by the day they happened, then by the order written. */
export function replay(rows: readonly ReplayRow[]): Map<string, Settled> {
  /** What the shelf holds as the log is walked. Index 0 is whole things. */
  const running: Record<number, number> = { 0: 0, 80: 0, 60: 0, 40: 0, 20: 0 };
  const held: Valued = { qty: 0, valueOre: 0 };
  const out = new Map<string, Settled>();

  for (const row of rows) {
    let units = row.units;
    let open: OpenBottles = { ...row.open };

    // A count states the shelf, so its difference is recomputed here.
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

    const delta = valueDelta(held, {
      kind: row.kind,
      units,
      unitCostOre: row.unitCostOre,
    });
    held.qty += costBasis({ units });
    held.valueOre += delta;

    out.set(row.id, { units, open, valueDeltaOre: delta });
  }
  return out;
}
