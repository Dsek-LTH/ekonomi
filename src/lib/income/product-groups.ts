// How a day's sold products are laid out: grouped by product, variants indented
// under the name they belong to.
//
// A till rings up "Macka" three times with a different variant each (ost,
// skinka, hummus) and read as three unrelated rows that is a list where the
// same word appears three times and the thing that differs is at the end of it.
// Grouped, the name is said once and what actually differs lines up under it.
//
// This is a port, not an invention. The intäktsräkning has laid its products out
// this way all along (intakt/report/pdf.go, `productRowsToTex`) and the review
// screen showed a flat list beside it. The same day, in two shapes, side by
// side on one screen, because the PDF is in the document panel while you work.
// So the rules here are that file's rules, down to the sort:
//
//   • group by the product's trimmed name, groups in name order;
//   • inside a group, by variant (case-insensitively), then account, then unit
//     price, so the same day always reads the same way;
//   • a group where *anything* carries a variant gets a heading of its own and
//     its rows indented under it; one where nothing does is just its rows.
//
// Keep the two in step. If pdf.go's ordering changes, this changes with it, or
// the table and the document it renders stop being the same list.
export interface GroupableLine {
  name: string;
  variant: string | null;
  account: string;
  unitPrice: number;
}

/**
 * A row to draw: either a group's heading, or one sold line.
 *
 * The heading carries no figures. Quantities and amounts belong to the lines,
 * and a group total would be a number the document does not have.
 */
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

/**
 * What one line is called on its own: "Läsk Stor".
 *
 * The document's `displayName`. Used where a line has to be identifiable
 * without the heading above it to lean on: a row outside any group, and the
 * move dialog, which shows a handful of lines lifted out of their day.
 */
export function productDisplayName(line: GroupableLine): string {
  const variant = (line.variant ?? "").trim();
  return variant ? `${line.name} ${variant}` : line.name;
}

// Byte order, as Go's `slices.Sort` gives for strings, rather than a
// locale-aware collation: the document sorts one way and this has to sort the
// same way, and "å after z" is what both of these do.
const byCodePoint = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

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
      const variant = byCodePoint(
        (a.variant ?? "").toLowerCase(),
        (b.variant ?? "").toLowerCase(),
      );
      if (variant !== 0) return variant;
      const account = byCodePoint(a.account, b.account);
      if (account !== 0) return account;
      return a.unitPrice - b.unitPrice;
    });

    // Any variant at all, not several: one variant among a product's rows is
    // still a distinction worth stepping in, and it is what the document does.
    const grouped = sorted.some((l) => (l.variant ?? "").trim() !== "");
    if (grouped) rows.push({ kind: "group", key: `group:${name}`, name });

    for (const [i, line] of sorted.entries()) {
      const variant = (line.variant ?? "").trim();
      rows.push({
        kind: "line",
        // The lines carry no id here. This stays usable for anything shaped
        // like a sold line, so position within the group is the key. Stable,
        // because the order above is a pure function of the lines.
        key: `${name}:${i}`,
        line,
        label: grouped && variant ? variant : productDisplayName(line),
        indented: grouped && variant !== "",
      });
    }
  }

  return rows;
}
