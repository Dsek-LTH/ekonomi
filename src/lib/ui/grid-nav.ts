// Moving between the cells of a sheet with the keyboard.
//
// Pure geometry: a grid of cell names, and the four questions a key press asks
// of it. What is next, what is previous, what is above, what is below. Nothing
// here knows what a cell contains or how it is drawn. The caller passes a
// predicate saying which cells can currently take the caret, and gets a name
// back.
//
// Deliberately separate from the budget sheet's `use-cell-edit`, which answers
// a different question. That one is select-versus-edit: whether a keypress
// belongs to the cell or to the text inside it, and it leaves movement entirely
// to the browser's own focus order. This one is movement, for a grid where the
// browser's order is not the one a person wants: a table row holds a link and
// a remove button as well as its figures, and tabbing through those between
// every pair of numbers is not how anybody fills in a sheet.
//
// Two rules worth stating because they are easy to get wrong:
//
// A cell that cannot take focus is skipped, not stopped at. A locked rung in
// the middle of a column, or a column a phone is not showing, is a hole rather
// than the end.
//
// And a direction that runs out returns nothing rather than wrapping. Wrapping
// belongs to `nextCell`, which is a sequence; an arrow is a direction, and the
// edge of a grid is where it stops.

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

/**
 * The next cell reading the way the sheet is written: across, then down.
 *
 * What Tab does. Running off the end of a row continues on the next one, which
 * is what makes it a sequence rather than a direction, and running off the end
 * of the grid returns nothing, so the caller can let the key fall through and
 * leave rather than trapping focus.
 */
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

/**
 * The next cell in a direction, which is what an arrow means.
 *
 * Keeps going past cells that cannot take the caret, and stops at the edge of
 * the grid rather than continuing on the other side.
 */
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
 * Whether the caret has run out of text in this direction.
 *
 * The one thing that lets left and right move between cells at all: inside a
 * box those keys belong to the text, and a cell may hold a sum somebody is part
 * way through typing. At the edge of it there is nothing left to move over, so
 * the next press leaves. A selection is never at an edge: something is
 * highlighted, and the arrow collapses it.
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
