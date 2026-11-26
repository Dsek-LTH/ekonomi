"use client";

// A spreadsheet's rectangle of cells on a budget sheet: press on a line's Beskrivning or Belopp
// and drag, Shift+click, or Shift+arrows from the selected cell. A block stays inside the account
// it was started in: a sheet is a stack of small tables, one per account, not one grid. The cell pressed first keeps
// focus (Excel's active cell), so typing still edits that one. What a range is for: ⌘C copies it
// as tab-separated text (pastes as cells in a spreadsheet), and the sheet shows its sum.
//
// Mouse only. On touch a drag scrolls, and there is no hover to steer by.
import { useEffect, useRef, useState } from "react";
import { autoScrollStep, verticalScroller } from "@/lib/ui/auto-scroll";

/**
 * An account's own row in the block's order, beside its lines' ids: its name under Beskrivning
 * and its total under Belopp are cells of the block too, so a block can take the account's row.
 */
export const headerKey = (accountId: string) => `acct:${accountId}`;
export const isHeaderKey = (key: string) => key.startsWith("acct:");

/** The columns a range spans, left to right. A cell says which with `data-range-col`. */
export const RANGE_COLS = ["description", "expression"] as const;

interface Cell {
  line: string;
  col: number;
}

export interface RangeRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

type Direction = "up" | "down" | "left" | "right";

export function useRangeSelect({
  order,
  accountOf,
  sheetRef,
  isEditing,
}: {
  /** The sheet's line ids top to bottom, as drawn (both sections, every account). */
  order: string[];
  /** The account a line is in. An account's lines are next to each other in `order`. */
  accountOf: (line: string) => string | undefined;
  sheetRef: React.RefObject<HTMLElement | null>;
  isEditing: () => boolean;
}) {
  const [range, setRange] = useState<{ a: Cell; b: Cell } | null>(null);
  // Whole rows added with ⌘-click on their numbers, beside the block: a selection need not be one
  // unbroken run. Kept to one account, as the block is. A new block or click lets go of them.
  const [extra, setExtra] = useState<string[]>([]);
  const dragging = useRef(false);

  const rowOf = new Map(order.map((id, i) => [id, i]));
  /** The far corner moved to `b`, kept inside the account of the corner `a`. */
  const within = (a: Cell, b: Cell): Cell => ({
    line: clampToAccount(order, accountOf, a.line, b.line),
    col: b.col,
  });
  // The drag's listeners are set up once, so they reach the latest rows through this.
  const latest = useRef(within);
  useEffect(() => {
    latest.current = within;
  });
  const ra = range ? rowOf.get(range.a.line) : undefined;
  const rb = range ? rowOf.get(range.b.line) : undefined;
  // A line that has gone (deleted, moved to another sheet) ends the range.
  const rect: RangeRect | null =
    range && ra !== undefined && rb !== undefined
      ? {
          top: Math.min(ra, rb),
          bottom: Math.max(ra, rb),
          left: Math.min(range.a.col, range.b.col),
          right: Math.max(range.a.col, range.b.col),
        }
      : null;
  const count = rect ? (rect.bottom - rect.top + 1) * (rect.right - rect.left + 1) : 0;
  /** One cell is just the selected cell: only a real block is drawn and copied as one. */
  const multi = count > 1;

  /** Whether the event happened in the sheet's own DOM (not in a portal React nests under it). */
  const inSheet = (e: React.SyntheticEvent) =>
    e.target instanceof Node && sheetRef.current?.contains(e.target) === true;

  /** The range cell under `el`, if it is one of this sheet's. */
  function cellAt(el: Element | null): { cell: Cell; td: HTMLElement } | null {
    const td = el?.closest<HTMLElement>("td[data-range-col]");
    const tr = td?.closest<HTMLElement>("tr[data-line], tr[data-account-row]");
    const line =
      tr?.dataset.line ?? (tr?.dataset.accountRow ? headerKey(tr.dataset.accountRow) : undefined);
    if (!td || !line || !sheetRef.current?.contains(td)) return null;
    return { cell: { line, col: Number(td.dataset.rangeCol) }, td };
  }

  // The drag: followed on the document, so it carries on outside the sheet and past its edge,
  // which scrolls the view (a frame loop, since a held pointer that does not move sends nothing).
  const pointer = useRef({ x: 0, y: 0 });
  useEffect(() => {
    let frame = 0;
    let scroller: HTMLElement | null = null;
    const extendTo = (x: number, y: number) => {
      const hit = cellAt(document.elementFromPoint(x, y));
      if (!hit) return;
      setRange((r) => {
        if (!r) return r;
        const b = latest.current(r.a, hit.cell);
        return r.b.line !== b.line || r.b.col !== b.col ? { a: r.a, b } : r;
      });
    };
    const tick = () => {
      if (!dragging.current) return;
      if (autoScrollStep(scroller, pointer.current.y))
        extendTo(pointer.current.x, pointer.current.y);
      frame = requestAnimationFrame(tick);
    };
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      pointer.current = { x: e.clientX, y: e.clientY };
      extendTo(e.clientX, e.clientY);
    };
    const onUp = () => {
      dragging.current = false;
      cancelAnimationFrame(frame);
    };
    const onDown = () => {
      if (!dragging.current) return;
      scroller = verticalScroller(sheetRef.current);
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(tick);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    // After the sheet's own mousedown (bubbling reaches the document last), which starts the drag.
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("mousedown", onDown);
      cancelAnimationFrame(frame);
    };
    // The handlers read refs and the latest sheet through cellAt; once is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** On the sheet's wrapper. Pressing a cell starts a range there; pressing anything else drops it. */
  function onMouseDown(e: React.MouseEvent) {
    if (e.button !== 0) return;
    // A row's or account's number selects that itself, so a press there leaves the block be.
    if ((e.target as Element).closest("[data-row-number]")) return;
    // Only presses in the sheet itself. React passes on events from a portal drawn elsewhere (the
    // bar at the foot of the screen), and a press on its Klipp ut would drop the block it is for.
    if (!inSheet(e)) return;
    const hit = cellAt(e.target as Element);
    if (!e.shiftKey) setExtra([]);
    if (!hit) {
      setRange(null);
      return;
    }
    // Inside the cell being written in, the press moves the caret.
    if (isEditing() && hit.td.contains(document.activeElement)) return;
    if (e.shiftKey && range) {
      e.preventDefault();
      setRange({ a: range.a, b: within(range.a, hit.cell) });
      return;
    }
    // A double-click is the browser's (it puts the caret where it lands, use-cell-edit.ts).
    if (e.detail > 1) return;
    // Selecting, not writing: no text selection inside the input, so the drag selects cells.
    // The press then focuses the cell itself, as the browser would have.
    e.preventDefault();
    hit.td.querySelector<HTMLInputElement>("input[data-cell]")?.focus({ preventScroll: true });
    setRange({ a: hit.cell, b: hit.cell });
    dragging.current = true;
    pointer.current = { x: e.clientX, y: e.clientY };
  }

  /** On the sheet's wrapper: a cell reached any other way (an arrow, Tab) starts afresh there. */
  function onFocus(e: React.FocusEvent) {
    if (dragging.current || !inSheet(e)) return;
    const hit = cellAt(e.target as Element);
    setExtra([]);
    setRange(hit ? { a: hit.cell, b: hit.cell } : null);
  }

  /** Shift+arrow from the selected cell: the far corner moves. False at the edge or with no range. */
  function extend(dir: Direction): boolean {
    if (!range || rb === undefined) return false;
    const row = rb + (dir === "down" ? 1 : dir === "up" ? -1 : 0);
    const col = range.b.col + (dir === "right" ? 1 : dir === "left" ? -1 : 0);
    if (row < 0 || row >= order.length || col < 0 || col >= RANGE_COLS.length) return true;
    setRange({ a: range.a, b: within(range.a, { line: order[row], col }) });
    return true;
  }

  /**
   * The whole of rows, as clicking a row's number does in a spreadsheet: `line` alone, or with
   * `extend` (Shift) every row from the selection's first row to it, within its account. The
   * row's Beskrivning takes focus, so the keys act on the selection.
   */
  function selectRows(line: string, extend = false) {
    const last = RANGE_COLS.length - 1;
    const from = extend && range ? range.a.line : line;
    const a = { line: from, col: 0 };
    if (!extend) setExtra([]);
    focusQuietly(from);
    setRange({ a, b: within(a, { line, col: last }) });
  }

  /**
   * ⌘-click on a row's number: the row joins the selection, or leaves it if it was in it, and the
   * rest stays. A row of another account starts the selection afresh, as it stays in one account.
   */
  function toggleRow(line: string) {
    const account = accountOf(line);
    if (rows.length > 0 && accountOf(rows[0]) !== account) {
      selectRows(line);
      return;
    }
    // Everything chosen becomes rows picked one by one (a block of cells, not whole rows, goes).
    const next = rows.includes(line) ? rows.filter((r) => r !== line) : [...rows, line];
    if (!rows.includes(line)) focusQuietly(line);
    setRange(null);
    setExtra(next);
  }

  /** Focus a row's first cell without its focus starting a new block (`onFocus`). */
  function focusQuietly(line: string) {
    const input = sheetRef.current?.querySelector<HTMLInputElement>(
      `tr[data-line="${CSS.escape(line)}"] input[data-cell]`,
    );
    dragging.current = true;
    input?.focus({ preventScroll: true });
    dragging.current = false;
  }

  /** Escape: back to the one selected cell. False when there was no block to drop. */
  function collapse(): boolean {
    if (extra.length > 0) {
      setExtra([]);
      if (range) setRange({ a: range.a, b: range.a });
      return true;
    }
    if (!multi || !range) return false;
    setRange({ a: range.a, b: range.a });
    return true;
  }

  /** The block's line ids, top to bottom. */
  const lines = rect ? order.slice(rect.top, rect.bottom + 1) : [];
  // The whole rows selected, in drawn order: the block's when it spans the row, and any added
  // with ⌘-click. Lines gone since are dropped.
  const blockRows = rect && rect.left === 0 && rect.right === RANGE_COLS.length - 1 ? lines : [];
  const rows = order.filter((id) => blockRows.includes(id) || extra.includes(id));
  // The same rows in runs of neighbours, each drawn as one box.
  const runs: string[][] = [];
  for (const id of rows) {
    const prev = runs.at(-1);
    if (prev && rowOf.get(prev.at(-1)!) === rowOf.get(id)! - 1) prev.push(id);
    else runs.push([id]);
  }

  return {
    rect,
    multi,
    count,
    lines,
    /** Whole rows selected (the block's when across the row, and any ⌘-clicked), in order. */
    rows,
    /** `rows` in runs of neighbours. */
    runs,
    toggleRow,
    onMouseDown,
    onFocus,
    extend,
    collapse,
    selectRows,
    /** Whether a line's whole row is selected (its number is drawn chosen). */
    rowSelected: (line: string) => rows.includes(line),
    /** Whether a cell is in the block, and which of its sides are the block's edges. */
    at(line: string, col: number) {
      const row = rowOf.get(line);
      if (!multi || !rect || row === undefined) return null;
      if (row < rect.top || row > rect.bottom || col < rect.left || col > rect.right) return null;
      return {
        top: row === rect.top,
        bottom: row === rect.bottom,
        left: col === rect.left,
        right: col === rect.right,
      };
    },
    clear: () => {
      setRange(null);
      setExtra([]);
    },
  };
}
export type RangeSelect = ReturnType<typeof useRangeSelect>;

/**
 * `line`, or if it is in another account than `anchor`, the nearest line of the anchor's account
 * on the way to it: its last line for one further down, its first for one further up.
 */
export function clampToAccount(
  order: string[],
  accountOf: (line: string) => string | undefined,
  anchor: string,
  line: string,
): string {
  const account = accountOf(anchor);
  if (account === undefined || accountOf(line) === account) return line;
  const at = order.indexOf(line);
  const own = order.flatMap((id, i) => (accountOf(id) === account ? [i] : []));
  if (own.length === 0) return anchor;
  const first = own[0];
  const last = own[own.length - 1];
  return order[at > last ? last : at < first ? first : order.indexOf(anchor)];
}

/** A Belopp as a spreadsheet reads it on paste: kronor, decimal comma, no thousands spaces. */
export function amountForCopy(ore: number | undefined): string {
  if (ore === undefined || !Number.isFinite(ore)) return "";
  return (ore / 100).toFixed(2).replace(".", ",");
}
