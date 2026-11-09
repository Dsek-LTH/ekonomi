// Keeps a sheet topped up with a fixed number of empty rows.

/**
 * `rows` with exactly `count` empty ones, or null when it already is (nothing to write back).
 * Empty rows count anywhere, not just trailing. Additions go on the end, and so do removals.
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
