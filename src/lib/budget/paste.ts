// Pointing a copied row's equations at the copies.
//
// A budget row's equation can name another row by its id (`@L<lineItemId>:<f>`),
// which is what makes a reference survive its row being renamed, reordered or
// dragged to another account (see lib/budget/grid.ts).
//
// Copy two rows where one reads the other, paste them somewhere else, and the
// question is which row the copy is asking about. The answer here is: the copy.
// A block that was internally consistent stays internally consistent, so a
// pasted pair of rows adds up the way the pair it came from did. Anything the
// block pointed at from *outside* itself (a row of another account, an account
// total, a variable) is left exactly where it was aimed, because that is a
// reference to something that has not been copied and still means what it said.
//
// That is the same rule a spreadsheet applies to a relative reference inside a
// copied range, and the same one anyone dragging a formula down a column has
// already met.

/** Every field of a row that can hold an equation. */
interface RowFormulas {
  expression: string;
  quantity: string | null;
  unitPrice: string | null;
  values: unknown;
}

/** The written form of a row reference: `@L<id>:<field>`. */
const ROW_REF = /@L([a-z0-9]+):([A-Za-z0-9]+)/gi;

/** One equation with references to copied rows pointed at their copies. */
export function rebindFormula(formula: string, copied: ReadonlyMap<string, string>): string {
  return formula.replace(ROW_REF, (whole, id: string, field: string) => {
    const to = copied.get(id);
    return to ? `@L${to}:${field}` : whole;
  });
}

/**
 * What to change about a pasted row so its equations read the copies, or null
 * when it referred to nothing that was copied, which is the ordinary case, and
 * worth not writing to the database for.
 */
export function rebindCopiedRefs(
  row: RowFormulas,
  copied: ReadonlyMap<string, string>,
): { expression: string; quantity: string | null; unitPrice: string | null; values: Record<string, string> } | null {
  const values: Record<string, string> =
    row.values && typeof row.values === "object" && !Array.isArray(row.values)
      ? (row.values as Record<string, string>)
      : {};

  const bound = {
    expression: rebindFormula(row.expression, copied),
    quantity: row.quantity === null ? null : rebindFormula(row.quantity, copied),
    unitPrice: row.unitPrice === null ? null : rebindFormula(row.unitPrice, copied),
    values: Object.fromEntries(
      Object.entries(values).map(([k, v]) => [k, typeof v === "string" ? rebindFormula(v, copied) : v]),
    ) as Record<string, string>,
  };

  const same =
    bound.expression === row.expression &&
    bound.quantity === row.quantity &&
    bound.unitPrice === row.unitPrice &&
    Object.entries(bound.values).every(([k, v]) => values[k] === v);
  return same ? null : bound;
}
