// How the review screen lays out a day's sold lines: by the account they are
// credited to, products grouped inside each one as the intäktsräkning groups
// them (./product-groups.ts).
//
// By account because the accounts are what the voucher's credit rows and the
// document's "Fördelning" are made of. A section per account, with its
// subtotal, is the same figures in the same order in all three places, so a
// reviewer reads the table, the voucher and the PDF as one list rather than
// adding up a flat one in their head.
//
// On the reserv's day there is one more grouping. Its lines are the ones the
// routing could not place, mostly products rung up with a prefix no
// verksamhet has ("s0 - Briska Hallon" when nobody owns s0). Those are drawn
// together under the prefix, so a whole mis-prefixed batch is seen, and moved,
// as one thing instead of being scattered through the products by name.
import { productRows, type GroupableLine, type ProductRow } from "./product-groups";

/** What a section carries for its lines: the account's name, and the amount. */
export interface SectionLine extends GroupableLine {
  accountName: string;
  total: number;
}

export type SoldRow<T> =
  | ProductRow<T>
  | {
      kind: "prefix";
      key: string;
      /** The prefix as rung up, "s0". */
      prefix: string;
      /** Every line under it, for moving them together. */
      lines: T[];
    };

export interface SoldSection<T> {
  account: string;
  accountName: string;
  /** The section's sum: what the voucher credits this account. */
  total: number;
  rows: SoldRow<T>[];
}

// A short code, then a dash. Display only: it says why a line is in the reserv,
// and never decides where anything goes (lib/income/routing.ts does). A space
// alone is not enough here, unlike in routing, or "Coca cola" would read as
// the prefix "Coca".
const PREFIX = /^([A-Za-z0-9]{1,5})\s*[-\u2013\u2014]\s*(.+)$/;

/** The prefix a reserv line was rung up with, and its name without it. */
export function unplacedPrefix(name: string): { prefix: string; rest: string } | null {
  const m = PREFIX.exec(name.trim());
  return m ? { prefix: m[1], rest: m[2].trim() } : null;
}

const byCodePoint = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** `text` without the prefix `key` at its start, or unchanged if it has another. */
function stripPrefix(text: string, key: string): string {
  const split = unplacedPrefix(text);
  return split && split.prefix.toLowerCase() === key ? split.rest : text;
}

/**
 * The day's lines as account sections, in account order.
 *
 * `reserv` is whether the day is the reserv's. Only then are prefixed lines
 * pulled out under their prefix, ahead of the products, since they are what
 * the review of that day is about. On any other day a dash in a product's name
 * is just part of its name.
 */
export function soldSections<T extends SectionLine>(lines: readonly T[], reserv: boolean): SoldSection<T>[] {
  const byAccount = new Map<string, T[]>();
  for (const line of lines) {
    const group = byAccount.get(line.account);
    if (group) group.push(line);
    else byAccount.set(line.account, [line]);
  }

  return [...byAccount.keys()].sort(byCodePoint).map((account) => {
    const group = byAccount.get(account)!;
    const rows: SoldRow<T>[] = [];
    let plain = group;

    if (reserv) {
      const byPrefix = new Map<string, T[]>();
      plain = [];
      for (const line of group) {
        const split = unplacedPrefix(line.name);
        if (!split) {
          plain.push(line);
          continue;
        }
        const key = split.prefix.toLowerCase();
        const under = byPrefix.get(key);
        if (under) under.push(line);
        else byPrefix.set(key, [line]);
      }
      for (const key of [...byPrefix.keys()].sort(byCodePoint)) {
        const under = byPrefix.get(key)!;
        rows.push({ kind: "prefix", key: `prefix:${account}:${key}`, prefix: unplacedPrefix(under[0].name)!.prefix, lines: under });
        // Grouped by product as everywhere else, with the prefix taken off the
        // name and, where the till repeated it there, off the variant too:
        // "s5 - Mat" with "s5 - Billys" reads as "Mat", then "Billys" under it.
        const stripped = under.map((line) => ({
          ...line,
          name: unplacedPrefix(line.name)!.rest,
          variant: line.variant && stripPrefix(line.variant, key),
        }));
        for (const row of productRows(stripped)) {
          rows.push(
            row.kind === "line"
              ? { ...row, key: `prefix:${account}:${key}:${row.key}`, indented: true }
              : { ...row, key: `prefix:${account}:${key}:${row.key}` },
          );
        }
      }
    }

    for (const row of productRows(plain)) rows.push({ ...row, key: `${account}:${row.key}` });

    return {
      account,
      accountName: group[0].accountName,
      // Summed in öre and back, so a column of kronor with öre in them does not
      // come out a hair off in floating point.
      total: group.reduce((sum, l) => sum + Math.round(l.total * 100), 0) / 100,
      rows,
    };
  });
}
