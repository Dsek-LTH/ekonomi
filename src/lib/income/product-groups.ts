// How a day's sold products are laid out: grouped by trimmed name (name order), variants indented
// under it, sorted by variant (case-insensitive), account, unit price. Must stay in step with
// intakt's pdf.go `productRowsToTex`, so the table and the rendered document match. One
// difference: the variant-less row under a heading is also stepped in.

export interface GroupableLine {
  name: string;
  variant: string | null;
  account: string;
  unitPrice: number;
}

/** A row to draw: a group heading (no figures) or one sold line. */
export type ProductRow<T> =
  | { kind: "group"; key: string; name: string }
  | {
      kind: "line";
      key: string;
      line: T;
      /** What to call it here: the variant alone under a heading, else the name. */
      label: string;
      /** Whether it sits under a heading, and so is drawn stepped in. */
      indented: boolean;
    };

/** What one line is called on its own: "Läsk Stor" (the document's `displayName`). */
export function productDisplayName(line: GroupableLine): string {
  const variant = (line.variant ?? "").trim();
  return variant ? `${line.name} ${variant}` : line.name;
}

// Byte order, as Go's `slices.Sort`, so this sorts like the document ("å after z").
export const byCodePoint = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function productRows<T extends GroupableLine>(lines: readonly T[]): ProductRow<T>[] {
  const byName = new Map<string, T[]>();
  for (const line of lines) {
    const name = line.name.trim();
    const group = byName.get(name);
    if (group) group.push(line);
    else byName.set(name, [line]);
  }

  const rows: ProductRow<T>[] = [];
  for (const name of [...byName.keys()].sort(byCodePoint)) {
    const group = byName.get(name)!;
    const sorted = group.toSorted((a, b) => {
      const variant = byCodePoint((a.variant ?? "").toLowerCase(), (b.variant ?? "").toLowerCase());
      if (variant !== 0) return variant;
      const account = byCodePoint(a.account, b.account);
      if (account !== 0) return account;
      return a.unitPrice - b.unitPrice;
    });

    // Any variant at all (even one) gets a heading, as the document does.
    const grouped = sorted.some((l) => (l.variant ?? "").trim() !== "");
    if (grouped) rows.push({ kind: "group", key: `group:${name}`, name });

    for (const [i, line] of sorted.entries()) {
      const variant = (line.variant ?? "").trim();
      rows.push({
        kind: "line",
        // No ids here, so position in the group is the (stable) key.
        key: `${name}:${i}`,
        line,
        label: grouped && variant ? variant : productDisplayName(line),
        indented: grouped,
      });
    }
  }

  return rows;
}
