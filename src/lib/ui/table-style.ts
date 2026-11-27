// One density for every table that is read: the lists (components/ui/data-table.tsx) and the tables inside a card
// (a day's lines, a reconciliation, a comparison). A grid that is typed in (the kontering, a stocktake) is a
// spreadsheet instead, with a tinted head and column rules (lib/ui/grid-table.ts).
//
// The rule, so two tables side by side never disagree: a plain head in small muted type over a single rule, rows of
// one height, a 12px gutter between columns and the card's inset at the edges, and figures right-aligned in a column
// of one width that never wraps.

/** Outer columns take the card's inset so their edges line up with the toolbar and the card's other content. */
export const CELL_X = "px-3 first:pl-inset last:pr-inset";

/** The head row: small muted type over one rule, no fill. */
export const HEAD_ROW = "border-b border-border text-left text-xs font-medium text-muted";

/** A head cell: 36px. */
export const TH = `${CELL_X} h-9 py-2 font-medium`;

/**
 * A body cell: 40px, whether the row holds text, a status pill or a small button, so a list does not change rhythm
 * from one row to the next. A cell of two lines grows past it.
 */
export const TD = `${CELL_X} h-10 py-2`;

/** A column of figures: right-aligned, one width, never wrapped. On the head cell and the body cells alike. */
export const NUM = "w-32 whitespace-nowrap text-right tabular-nums";
