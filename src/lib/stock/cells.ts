// The event sheet: a cell is one row in the log (unique per event, product, direction, rung).
// Counts are positive, in things. `entryColumns` is the one place that turns a cell into signed ledger columns.

import { LEVELS, type BottleStock, type Level, type OpenBottles } from "./levels";
import { tagTotals, type TagSubject, type TagTotals } from "./event";

/** The three columns. Nothing else is registered against a night. */
export type CellKind = "CHECKOUT" | "RETURN" | "WASTE";
export const CELL_KINDS: readonly CellKind[] = ["CHECKOUT", "RETURN", "WASTE"];

/** The rung of a whole, unopened thing: a sealed bottle, or any can. */
export const WHOLE = 0;

/** The same four things the unique index is on, so a cell names exactly one row. */
interface CellRef {
  productId: string;
  kind: CellKind;
  /** `WHOLE`, or one of the four rungs. */
  level: number;
}

export const cellKey = (c: CellRef): string => `${c.productId}|${c.kind}|${c.level}`;

/** A stored row, as this file needs it. */
export interface CellRow {
  productId: string;
  kind: CellKind;
  level: number;
  units: number;
  open?: OpenBottles;
  spilledQty?: number;
}

/** The figure a row shows in its cell: positive, in things (the ledger stores checkouts as negatives). */
export function cellQty(row: CellRow): number {
  if (row.kind === "WASTE") return Math.abs(row.spilledQty ?? 0);
  const raw = row.level === WHOLE ? row.units : (row.open?.[row.level as Level] ?? 0);
  return Math.abs(raw);
}

export function cellTotals(rows: readonly CellRow[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const row of rows) {
    totals.set(cellKey(row), cellQty(row));
  }
  return totals;
}

export const cellValue = (totals: Map<string, number>, ref: CellRef): number =>
  totals.get(cellKey(ref)) ?? 0;

/** A checkout takes bottles off its rung, a return puts them on, a spill moves no stock (it already left at checkout). */
export function entryColumns(
  ref: CellRef,
  qty: number,
): { units: number; open: OpenBottles; spilledQty: number } {
  const blank = { units: 0, open: {} as OpenBottles, spilledQty: 0 };
  if (ref.kind === "WASTE") return { ...blank, spilledQty: qty };

  const sign = ref.kind === "CHECKOUT" ? -1 : 1;
  if (ref.level === WHOLE) return { ...blank, units: sign * qty };
  return { ...blank, open: { [ref.level as Level]: sign * qty } };
}

export const rowOf = (ref: CellRef, qty: number): CellRow => ({
  ...ref,
  ...entryColumns(ref, qty),
});

/** Same arithmetic as `tagTotals` over stored rows, and must stay in sync with it. */
export function totalsFromCells(
  product: TagSubject,
  productId: string,
  cells: Map<string, number>,
): TagTotals {
  const rows: CellRow[] = [];
  for (const [key, qty] of cells) {
    if (qty === 0) continue;
    const [owner, kind, level] = key.split("|");
    if (owner !== productId) continue;
    rows.push(rowOf({ productId, kind: kind as CellKind, level: Number(level) }, qty));
  }
  return tagTotals(product, rows);
}

/**
 * How many things (not millilitres) a night moved. Bottles are countable on their own:
 * three back at 20 % adds up in ml against two out, and is still impossible.
 */
function bottlesFromCells(
  productId: string,
  cells: Map<string, number>,
): { out: number; back: number; spilled: number } {
  let out = 0;
  let back = 0;
  let spilled = 0;
  for (const [key, qty] of cells) {
    if (qty === 0) continue;
    const [owner, kind] = key.split("|");
    if (owner !== productId) continue;
    if (kind === "CHECKOUT") out += qty;
    else if (kind === "RETURN") back += qty;
    else if (kind === "WASTE") spilled += qty;
  }
  return { out, back, spilled };
}

type CellFault =
  | "openBottlesFirst"
  | "notThatManyOpen"
  | "notThatManySealed"
  | "moreThanWentOut"
  | "moreBottlesThanWentOut";

/** What the cellar held at this rung before the event touched it, so the Ut ladder does not shift while the sheet is filled in. */
export function beforeTheNight(
  shelf: BottleStock,
  cells: Map<string, number>,
  productId: string,
  level: number,
): number {
  const here = level === WHOLE ? shelf.sealed : (shelf.open[level as Level] ?? 0);
  const took = cellValue(cells, { productId, kind: "CHECKOUT", level });
  const brought = cellValue(cells, { productId, kind: "RETURN", level });
  return here + took - brought;
}

/**
 * `sheet` is the night's own arithmetic (log plus unsaved cells). `booked` is the log only and
 * is what the shelf reflects: counting an unsaved checkout against it would spend bottles twice.
 */
export interface SheetState {
  /** The log plus whatever is typed and not yet saved (in the route, every cell of the request). */
  sheet: Map<string, number>;
  booked: Map<string, number>;
}

/** Whether a cell may be set to this, judged against the product's other cells. */
export function cellFault(
  product: TagSubject,
  shelf: BottleStock,
  state: SheetState,
  ref: CellRef,
  next: number,
): CellFault | null {
  // Against the log: what the cellar has already given up for this cell.
  const now = cellValue(state.booked, ref);
  const delta = next - now;

  // ── The night ──
  const after = new Map(state.sheet);
  after.set(cellKey(ref), next);
  const totals = totalsFromCells(product, ref.productId, after);
  if (totals.out - totals.back - totals.spilled < 0) return "moreThanWentOut";

  // The same night counted in bottles: a third cannot come back when two went out.
  const vessels = bottlesFromCells(ref.productId, after);
  if (vessels.back + vessels.spilled > vessels.out) return "moreBottlesThanWentOut";

  // A spill moves no stock.
  if (ref.kind === "WASTE" || delta === 0) return null;

  // Taking out is measured against the shelf before the night, bringing in against the shelf as it stands.
  if (ref.kind === "CHECKOUT") {
    if (next > beforeTheNight(shelf, state.booked, ref.productId, ref.level)) {
      return ref.level === WHOLE ? "notThatManySealed" : "notThatManyOpen";
    }
  } else if (ref.level === WHOLE) {
    if (shelf.sealed + delta < 0) return "notThatManySealed";
  } else if ((shelf.open[ref.level as Level] ?? 0) + delta < 0) {
    return "notThatManyOpen";
  }

  // The bar's rule: the dregs leave with you, or the fresh bottle stays. Only a sealed bottle
  // leaving is subject to it, and the night's own Ut ladder counts as left behind.
  if (ref.kind === "CHECKOUT" && ref.level === WHOLE && delta > 0) {
    const standing = LEVELS.reduce((n, level) => {
      const there = beforeTheNight(shelf, state.booked, ref.productId, level);
      const taken = cellValue(after, { productId: ref.productId, kind: "CHECKOUT", level });
      return n + Math.max(0, there - taken);
    }, 0);
    if (standing > 0) return "openBottlesFirst";
  }
  return null;
}
