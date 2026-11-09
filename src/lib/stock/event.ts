// What a night sold: taken out - brought back - spilled, per event, in the product's own unit
// (units for a can, millilitres for a spirit). Each kind counts along its own direction, because
// the event sheet writes a lowered cell as a same-kind movement with the opposite sign.

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

/** What one whole thing at this rung holds, in the product's own unit. Shared with cells.ts so both round the same way. */
function levelVolume(product: TagSubject, level: number): number {
  if (product.kind !== "VOLUME") return 1;
  const whole = product.nominalMl ?? 0;
  if (level === 0) return whole;
  return isLevel(level) ? Math.round((whole * level) / 100) : 0;
}

/** What one movement did in the product's own unit (millilitres for a spirit), keeping the log's sign. */
export function movementVolume(product: TagSubject, m: TagMovement): number {
  if (product.kind !== "VOLUME") return m.units;
  const open = LEVELS.reduce(
    (sum, level) => sum + (m.open?.[level] ?? 0) * levelVolume(product, level),
    0,
  );
  return m.units * levelVolume(product, 0) + open;
}

/** What a spill cost: a dropped bottle loses what is left at its rung. */
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
  /** Taken out less returned and destroyed, floored at zero. */
  sold: number;
}

/** Signed sums per kind (a checkout of +120 reads as 120 less out); only `sold` is floored. */
export function tagTotals(product: TagSubject, movements: readonly TagMovement[]): TagTotals {
  let out = 0;
  let back = 0;
  let spilled = 0;
  for (const m of movements) {
    // A checkout is stored negative, so what went out is its opposite.
    if (m.kind === "CHECKOUT") out -= movementVolume(product, m);
    else if (m.kind === "RETURN") back += movementVolume(product, m);
    else if (m.kind === "WASTE") spilled += spillVolume(product, m);
  }
  return { out, back, spilled, sold: Math.max(0, out - back - spilled) };
}

/** What went out and is not yet returned or spilled: the ceiling on a return and on a spill. */
export const unaccounted = (totals: TagTotals): number =>
  Math.max(0, totals.out - totals.back - totals.spilled);
