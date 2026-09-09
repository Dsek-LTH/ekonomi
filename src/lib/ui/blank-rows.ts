// Keeping a sheet topped up with a fixed number of empty rows, so there is
// always somewhere to write the next line without reaching for an "add row"
// button. Written once here and shared, rather than once per sheet: the
// voucher editor had it first (components/voucher-editor.tsx), and a second
// sheet wanting the same behaviour at its own count is what pulled it out.

/**
 * `rows` with exactly `count` empty ones among them, or null when it already
 * is that — the signal to a caller's `useEffect` that nothing needs writing
 * back.
 *
 * `count` empty rows, not `count` empty rows *at the bottom*: a spare row can
 * be moved up between two filled ones and left there, to be written in next,
 * and counting only the trailing ones would answer that by adding another.
 *
 * New ones go on the end, where the next line is usually written. Extra ones
 * are taken from the end too, so a row someone is standing in, the one they
 * have just emptied, is never the one that disappears from under them.
 */
export function withBlankRows<T>(
  rows: T[],
  count: number,
  isBlank: (row: T) => boolean,
  makeBlank: () => T,
): T[] | null {
  const blanks = rows.length - rows.filter((r) => !isBlank(r)).length;
  if (blanks === count) return null;
  if (blanks < count) {
    return [...rows, ...Array.from({ length: count - blanks }, makeBlank)];
  }
  let extra = blanks - count;
  const kept: T[] = [];
  for (let i = rows.length - 1; i >= 0; i--) {
    if (extra > 0 && isBlank(rows[i])) {
      extra--;
      continue;
    }
    kept.unshift(rows[i]);
  }
  return kept;
}
