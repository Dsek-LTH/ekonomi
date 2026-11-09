// Keyboard movement between sheet cells: pure geometry over a grid of cell names, with a predicate for which cells can
// take the caret. Cells that cannot are skipped (holes), and a direction that runs out returns nothing instead of
// wrapping (only `nextCell`, a sequence, wraps).

/** A cell's name, or nothing where the grid has no cell. */
export type Cell = string | null;
export type Grid = readonly (readonly Cell[])[];

/** Where a cell sits, as `[row, column]`. */
export function findCell(grid: Grid, key: string): [number, number] | null {
  for (let r = 0; r < grid.length; r++) {
    const c = grid[r].indexOf(key);
    if (c >= 0) return [r, c];
  }
  return null;
}

/** The next cell reading across, then down (what Tab does). Nothing at the end of the grid, so the key can fall through. */
export function nextCell(
  grid: Grid,
  key: string,
  dir: 1 | -1,
  canFocus: (cell: string) => boolean,
): string | null {
  const at = findCell(grid, key);
  if (!at) return null;
  let [r, c] = at;
  const width = grid[r]?.length ?? 0;
  if (width === 0) return null;
  for (;;) {
    c += dir;
    if (c >= width) {
      c = 0;
      r += 1;
    } else if (c < 0) {
      r -= 1;
      c = (grid[r]?.length ?? width) - 1;
    }
    if (r < 0 || r >= grid.length) return null;
    const cell = grid[r][c];
    if (cell && canFocus(cell)) return cell;
  }
}

/** The next cell in a direction (an arrow). Skips cells that cannot take the caret and stops at the grid edge. */
export function stepCell(
  grid: Grid,
  key: string,
  dr: number,
  dc: number,
  canFocus: (cell: string) => boolean,
): string | null {
  const at = findCell(grid, key);
  if (!at || (dr === 0 && dc === 0)) return null;
  let [r, c] = at;
  for (;;) {
    r += dr;
    c += dc;
    if (r < 0 || r >= grid.length || c < 0 || c >= (grid[r]?.length ?? 0)) return null;
    const cell = grid[r][c];
    if (cell && canFocus(cell)) return cell;
  }
}

/**
 * Whether the caret has run out of text in this direction, so left/right may leave the cell.
 * A selection is never at an edge (the arrow collapses it).
 */
export function atTextEdge(
  el: { selectionStart: number | null; selectionEnd: number | null; value: string },
  dir: -1 | 1,
): boolean {
  const { selectionStart, selectionEnd, value } = el;
  // A field that does not report a selection at all (a number input in some
  // browsers) has no caret to preserve, so the arrow is free to move.
  if (selectionStart === null || selectionEnd === null) return true;
  if (selectionStart !== selectionEnd) return false;
  return dir < 0 ? selectionStart === 0 : selectionStart === value.length;
}
