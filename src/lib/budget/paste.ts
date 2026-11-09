// Pointing a copied row's equations at the copies. A reference to a copied row (`@L<id>:<f>`) is rebound to its copy.
// Anything pointing outside the block is left as aimed, like a relative reference in a copied spreadsheet range.

interface RowFormulas {
  expression: string;
  quantity: string | null;
  unitPrice: string | null;
  values: unknown;
}

const ROW_REF = /@L([a-z0-9]+):([A-Za-z0-9]+)/gi;

export function rebindFormula(formula: string, copied: ReadonlyMap<string, string>): string {
  return formula.replace(ROW_REF, (whole, id: string, field: string) => {
    const to = copied.get(id);
    return to ? `@L${to}:${field}` : whole;
  });
}

/** What to change on a pasted row so its equations read the copies, or null when it referred to nothing copied (the ordinary case). */
export function rebindCopiedRefs(
  row: RowFormulas,
  copied: ReadonlyMap<string, string>,
): {
  expression: string;
  quantity: string | null;
  unitPrice: string | null;
  values: Record<string, string>;
} | null {
  const values: Record<string, string> =
    row.values && typeof row.values === "object" && !Array.isArray(row.values)
      ? (row.values as Record<string, string>)
      : {};

  const bound = {
    expression: rebindFormula(row.expression, copied),
    quantity: row.quantity === null ? null : rebindFormula(row.quantity, copied),
    unitPrice: row.unitPrice === null ? null : rebindFormula(row.unitPrice, copied),
    values: Object.fromEntries(
      Object.entries(values).map(([k, v]) => [
        k,
        typeof v === "string" ? rebindFormula(v, copied) : v,
      ]),
    ) as Record<string, string>,
  };

  const same =
    bound.expression === row.expression &&
    bound.quantity === row.quantity &&
    bound.unitPrice === row.unitPrice &&
    Object.entries(bound.values).every(([k, v]) => values[k] === v);
  return same ? null : bound;
}
