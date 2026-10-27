// The event sheet, where a cell is a row.
//
// An event's page is a grid: a row per product, three columns (out, in,
// spill) and for a spirit a rung per line. Each cell holds a count, and that
// count *is* a row in the log: one per event, product, direction and rung,
// enforced by a unique index. Typing over it changes the row.
//
// It used to be a sum. A cell showed whatever its movements added up to, and
// correcting 120 to 100 meant appending a second movement of +20, so the
// ledger filled with rows nobody had done, and a delivery mistyped as 200
// bottles stayed on the books forever with a cancelling row beside it. Every
// piece of machinery that existed to express a state as a difference (the
// deltas, the reversals, the correction chains, the folding on the way out)
// is gone with it. What replaced them is a record of who changed what, which
// is the thing that was actually wanted: see StockChange in the schema.
//
// Counts here are always positive and always in things, cans or bottles. The
// signs and the columns belong to the ledger, and `entryColumns` is the one
// place that knows how a cell becomes them.

import { LEVELS, type BottleStock, type Level, type OpenBottles } from "./levels";
import { tagTotals, type TagSubject, type TagTotals } from "./event";

/** The three columns. Nothing else is registered against a night. */
export type CellKind = "CHECKOUT" | "RETURN" | "WASTE";
export const CELL_KINDS: readonly CellKind[] = ["CHECKOUT", "RETURN", "WASTE"];

/** The rung of a whole, unopened thing: a sealed bottle, or any can. */
export const WHOLE = 0;

/**
 * Which cell.
 *
 * The same four things the unique index is on, which is what lets a cell be
 * edited at all: it names exactly one row, so there is one place for a new
 * figure to go and no other cell can be disturbed by it.
 */
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

/**
 * The figure a row shows in its cell: positive, in things.
 *
 * The ledger stores a checkout as a negative because that is what it does to
 * the shelf. Nobody types a minus sign into a column headed "Ut", so this is
 * where the sign stops being the reader's problem.
 */
export function cellQty(row: CellRow): number {
  if (row.kind === "WASTE") return Math.abs(row.spilledQty ?? 0);
  const raw = row.level === WHOLE ? row.units : (row.open?.[row.level as Level] ?? 0);
  return Math.abs(raw);
}

/** What every cell of an event reads. */
export function cellTotals(rows: readonly CellRow[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const row of rows) {
    totals.set(cellKey(row), cellQty(row));
  }
  return totals;
}

export const cellValue = (totals: Map<string, number>, ref: CellRef): number =>
  totals.get(cellKey(ref)) ?? 0;

/**
 * What a cell's count becomes in the ledger's own columns.
 *
 * The one place a positive count turns into signed stock. A checkout takes
 * bottles off the rung it names; a return puts them on; a spill moves no stock
 * at all. What was dropped left the cellar when it was checked out, and taking
 * it off the shelf again would remove it twice.
 */
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

/** Turn a cell back into the shape the night's arithmetic reads. */
export const rowOf = (ref: CellRef, qty: number): CellRow => ({
  ...ref,
  ...entryColumns(ref, qty),
});

/**
 * What an event comes to for one product, from its cells alone.
 *
 * The same arithmetic `tagTotals` does over stored rows, reached from the other
 * end, and it has to stay that way, because these are the figures somebody
 * reads while typing and those are the ones that get filed.
 */
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
 * How many *things* a night moved, as opposed to how much.
 *
 * A second fact about a night, and independent of the first. The arithmetic
 * everywhere else is in millilitres, which is the right unit for what was
 * drunk, but three bottles cannot come home from a night that took two, and in
 * millilitres they can: three back at 20 % is 420 ml against the 1 400 that
 * left, which adds up fine and is still impossible. Bottles are countable
 * objects, and the count has to hold on its own.
 *
 * For a can the two questions are the same one, since a can's volume is itself.
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

/** Why a cell cannot hold what somebody typed. A key under `errors.stock`. */
type CellFault =
  | "openBottlesFirst"
  | "notThatManyOpen"
  | "notThatManySealed"
  | "moreThanWentOut"
  | "moreBottlesThanWentOut";

/**
 * What the cellar held at this rung *before* the event touched it.
 *
 * The figure a night's Ut column is measured against, and not the same as
 * what is on the shelf now, because the same sheet has been changing that.
 *
 * Without this the ladder mutates as you fill it in: bring two bottles back at
 * 60 %, and Ut - 60 % lights up offering you the two you have just carried in.
 * Which is not only confusing but pointless, since a return followed by a
 * re-checkout of the same bottles cancels out. Two out full, back at 60 %, out
 * again at 60 % is 1 400 ml gone, exactly what two out and never returned
 * comes to. There is no night on which anybody needs to record it.
 *
 * So an event may take out only what was there before it, and its Ut ladder
 * stays put for the whole night.
 */
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
 * The two readings of a sheet a cell is judged against.
 *
 * They are not the same map, and treating them as one was a bug in both the
 * browser and the route. Take eight beers out and, before saving, say one was
 * dropped: judged against the log alone the night has taken nothing out, so a
 * spill of one is one more than went out and is refused. The figure is on the
 * screen; the rule was looking somewhere else.
 *
 * So the night's own arithmetic (what went out, what came home, what broke)
 * reads `sheet`, which is what the sheet says now. Everything about the cellar
 * reads `booked`, because the shelf has moved for the rows in the log and for
 * nothing else: counting an unsaved checkout against it would spend the same
 * bottles twice.
 */
export interface SheetState {
  /** What the sheet reads: the log, plus whatever has been typed into it and
   *  not yet saved (in the route, plus every cell of the request). */
  sheet: Map<string, number>;
  /** What the log holds, which is what `shelf` reflects. */
  booked: Map<string, number>;
}

/**
 * Whether a cell may be set to this.
 *
 * Checked one cell at a time, because that is now how it is written, and the
 * check is against the product's *other* cells, since the rules are about a
 * product rather than a line: how much is still out is a fact about the night,
 * and what the cellar can give up is a fact about the shelf.
 */
export function cellFault(
  product: TagSubject,
  shelf: BottleStock,
  state: SheetState,
  ref: CellRef,
  next: number,
): CellFault | null {
  // Against the log, not the sheet: this is what the cellar has already given
  // up for this cell, and so what changing it moves.
  const now = cellValue(state.booked, ref);
  const delta = next - now;

  // ── The night ──
  const after = new Map(state.sheet);
  after.set(cellKey(ref), next);
  const totals = totalsFromCells(product, ref.productId, after);
  if (totals.out - totals.back - totals.spilled < 0) return "moreThanWentOut";

  // And the same night counted in bottles rather than in what was in them.
  // Two went out; a third cannot come back however little is left in it.
  const vessels = bottlesFromCells(ref.productId, after);
  if (vessels.back + vessels.spilled > vessels.out) return "moreBottlesThanWentOut";

  // ── The cellar ──
  //
  // A spill moves no stock, so nothing below applies to one.
  if (ref.kind === "WASTE" || delta === 0) return null;

  // Taking out is measured against what was there before the night, so an
  // event cannot take back out what it has just brought in. Bringing in is
  // measured against the shelf as it stands, because undoing a return really
  // does take those bottles off it.
  if (ref.kind === "CHECKOUT") {
    if (next > beforeTheNight(shelf, state.booked, ref.productId, ref.level)) {
      return ref.level === WHOLE ? "notThatManySealed" : "notThatManyOpen";
    }
  } else if (ref.level === WHOLE) {
    if (shelf.sealed + delta < 0) return "notThatManySealed";
  } else if ((shelf.open[ref.level as Level] ?? 0) + delta < 0) {
    return "notThatManyOpen";
  }

  // The bar's rule: the dregs leave with you, or the fresh bottle stays. Only a
  // sealed bottle *leaving* is subject to it. Putting one back, or taking an
  // opened one, is never the choice this guards against.
  //
  // What it asks about is the bottles left *behind*, so the night's own Ut
  // ladder counts. Take the last 20 % bottle along with a sealed one and
  // nothing is being left in the cellar to go stale, which is the whole of the
  // rule. Refusing it asked somebody to take the dregs and then told them they
  // had not. The rungs are read as the night found them (`beforeTheNight`,
  // against the log) less what the sheet takes off them, so a night's own
  // returns still do not lock its sealed bottles away.
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
