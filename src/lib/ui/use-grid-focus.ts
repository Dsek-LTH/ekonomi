"use client";

// Moving the caret around a sheet of inputs with the keyboard.
//
// lib/ui/grid-nav.ts knows the *shape* — which cell is next, given a grid with
// holes in it. This is the other half: the boxes themselves. It holds the map
// from cell key to input, decides whether a cell can take the caret at all, and
// turns a keystroke into a move.
//
// Both stock sheets had their own copy — the stocktake tag and the delivery —
// identical down to the rule about Tab falling through at the end. They differ
// in two things and only two: whether there is anywhere sideways to go, and
// what Escape puts a cell back to. Both are arguments here.
//
// Not the budget sheet's `use-cell-edit`: that one answers select-versus-edit
// and leaves movement to the browser's own focus order, which works there and
// does not here — a row of a stock sheet holds a product link and a remove
// button as well as its figures, and tabbing through those between every pair
// of numbers is not how anybody fills a sheet in.
import { useRef } from "react";

import { atTextEdge, nextCell, stepCell, type Grid } from "./grid-nav";

export function useGridFocus() {
  const inputs = useRef(new Map<string, HTMLInputElement>());

  /**
   * Whether a cell can take the caret at all.
   *
   * A hidden column has no offsetParent. The phone shows one column at a time,
   * and a keystroke must never send focus somewhere invisible.
   */
  const canFocus = (key: string): boolean => {
    const el = inputs.current.get(key);
    return Boolean(el && el.offsetParent !== null);
  };

  /** Put the caret in a cell. Answers whether there was one to put it in. */
  const focusCell = (key: string | null): boolean => {
    if (!key || !canFocus(key)) return false;
    inputs.current.get(key)?.focus();
    return true;
  };

  /** The `ref` for a cell's input, which keeps the map in step with the DOM. */
  const register = (key: string) => (el: HTMLInputElement | null) => {
    if (el) inputs.current.set(key, el);
    else inputs.current.delete(key);
  };

  /**
   * Handle a keystroke in a cell. Answers whether it was one of ours.
   *
   * Escape puts the cell back to what is booked and stays in it — the way out
   * of a half-typed sum without having to remember what was there.
   *
   * `horizontal` is for a sheet more than one column wide. Left and right
   * belong to the text until there is none left in that direction: a cell can
   * hold `24*10+30` and somebody may be in the middle of it.
   */
  function handleKey(
    e: React.KeyboardEvent<HTMLInputElement>,
    key: string,
    grid: Grid,
    opts: { horizontal?: boolean; onEscape?: (key: string) => void } = {},
  ): boolean {
    if (e.key === "Escape") {
      opts.onEscape?.(key);
      e.preventDefault();
      return true;
    }

    const back = e.shiftKey;
    const seq = (dir: 1 | -1) => nextCell(grid, key, dir, canFocus);
    const dir = (dr: number, dc: number) => stepCell(grid, key, dr, dc, canFocus);

    let target: string | null = null;
    if (e.key === "Tab") target = seq(back ? -1 : 1);
    // Enter goes down, the way it does in a sheet — and on a grid with ladders
    // in it falls to the next line when there is nothing below, so a ladder
    // still ends somewhere useful.
    else if (e.key === "Enter") {
      target = dir(back ? -1 : 1, 0) ?? (opts.horizontal ? seq(back ? -1 : 1) : null);
    } else if (e.key === "ArrowDown") target = dir(1, 0);
    else if (e.key === "ArrowUp") target = dir(-1, 0);
    else if (opts.horizontal && e.key === "ArrowLeft" && atTextEdge(e.currentTarget, -1)) {
      target = dir(0, -1);
    } else if (opts.horizontal && e.key === "ArrowRight" && atTextEdge(e.currentTarget, 1)) {
      target = dir(0, 1);
    } else return false;

    const moved = focusCell(target);
    // Tab falls through when there is nowhere left to go, so the sheet can still
    // be left by keyboard rather than becoming a trap. An arrow that reached the
    // edge simply does nothing, which is what an edge is.
    if (moved || e.key !== "Tab") e.preventDefault();
    return true;
  }

  // `inputs` and `canFocus` stay inside: a caller that reached for either
  // would be doing the hook's own job, and neither sheet needs to.
  return { focusCell, register, handleKey };
}
