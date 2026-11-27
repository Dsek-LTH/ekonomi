// How a ruled table is drawn where rows can be carried by hand (lib/ui/use-row-drag.ts): the kontering
// (components/voucher-editor.tsx) and the budget sheet (budget/[budgetId]/sheet-section.tsx).
//
// Separate borders, never collapsed. A collapsed rule belongs to the table, not to a cell, so a row moved with a
// transform leaves its column rules behind. With separate borders each cell owns its rules and takes them along.
// A <tr> or <tbody> border is not drawn in this model, so row rules are on the cells too.

/** On the <table>. */
export const GRID_TABLE = "border-separate border-spacing-0";

/** On a wrapper round the table: every rule in the gridline colour (`.grid-lines` in app/globals.css). */
export const GRID_LINES = "grid-lines";

/** On a <tr>: a rule between its cells, none after the last. */
export const COLUMN_RULES = "*:border-border *:not-last:border-r";

/** On a <tr> in a <tbody>: a rule above it, except the first, which the head's bottom rule already draws. */
export const ROW_RULES = "*:border-border not-first:*:border-t";

/**
 * On the <tr> being carried. Opaque so the rows under it do not show through, and outlined (an outline, since a
 * shadow is not painted on a table row). `pointer-events-none` lets the drag see the rows underneath, and
 * `transition-none` stops a colour transition from animating the outline in from currentColor.
 */
export const LIFTED_ROW =
  "pointer-events-none relative z-10 bg-background outline outline-1 outline-border transition-none";
