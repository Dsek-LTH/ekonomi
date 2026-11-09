// Free tags on an avtal. Lower-cased, trimmed, collapsed and de-duplicated here only, so
// the API, importers and search (`normaliseTag`) cannot drift (Postgres containment is exact).

/** Longest a single tag may be. */
export const MAX_TAG_LENGTH = 40;

/** Most tags one contract may carry (bounds its GIN index entry). */
export const MAX_TAGS = 20;

/** One tag as stored and searched. Inner whitespace is collapsed, not removed. */
export function normaliseTag(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").toLocaleLowerCase("sv-SE").slice(0, MAX_TAG_LENGTH);
}

/** A tag list: normalised, blanks removed, de-duplicated, capped. Keeps the given order (not sorted). */
export function normaliseTags(raw: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of raw) {
    const tag = normaliseTag(value);
    if (tag === "" || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
    if (out.length === MAX_TAGS) break;
  }
  return out;
}
