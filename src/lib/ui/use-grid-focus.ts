"use client";

// Keyboard caret movement around a sheet of inputs: holds the cell-to-input map, decides which cells can take the
// caret and turns keystrokes into moves (lib/ui/grid-nav.ts knows the grid shape). Callers differ in whether there is
// a sideways direction and what Escape resets to.
import { useEffect, useRef } from "react";

import { atTextEdge, nextCell, stepCell, type Grid } from "./grid-nav";

export function useGridFocus() {
  const inputs = useRef(new Map<string, HTMLInputElement>());

  /** Whether a cell can take the caret: a hidden column has no offsetParent, and focus must never go somewhere invisible. */
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
   * Handle a keystroke in a cell; answers whether it was ours. Escape resets the cell to what is booked.
   * `horizontal` is for sheets wider than one column: left/right belong to the text until none is left that way.
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
    // Enter goes down, and on a grid with ladders falls to the next line when nothing is below.
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
    // Tab falls through when there is nowhere left to go, so the sheet can still be left by keyboard.
    if (moved || e.key !== "Tab") e.preventDefault();
    return true;
  }

  return { focusCell, register, handleKey };
}

/**
 * Put the caret in a row that does not exist yet. The row may not be in the DOM until a later render (or a server
 * round trip for an unknown barcode), so the wanted row is latched and retried every render until it appears.
 * This is still a setState in an effect and still correct; the lint rule only misses it because the setter arrives as `clear`.
 *
 * @param seeking What is wanted, or null when nothing is.
 * @param clear   Called once the caret has landed.
 * @param attempt Tries to focus; answers whether it managed to.
 * @param deps    What may have brought the row into being (the latch itself is always watched).
 */
export function useSeekFocus(
  seeking: string | null,
  clear: () => void,
  attempt: (seeking: string) => boolean,
  deps: readonly unknown[],
): void {
  useEffect(() => {
    if (!seeking) return;
    if (!attempt(seeking)) return;
    clear();
    // `attempt` and `clear` change every render; what it waits on is the latch and the caller's lists.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seeking, ...deps]);
}
