// The free tags on an avtal, and the one rule that makes them searchable.
//
// A tag is typed by a person, which means "Ljud", "ljud" and " ljud " are the
// same word arriving three ways. Postgres containment is exact, so without a
// single normalisation on the way in, a search for one of them finds a third of
// the contracts and nobody ever learns why.
//
// So the rule is: lower-cased, trimmed, collapsed, de-duplicated, and that
// happens here and only here. Both the API and any importer go through
// `normaliseTags`, and the search goes through `normaliseTag`, so the two
// cannot drift apart.

/** Longest a single tag may be. Generous, and short enough that a pasted
 *  paragraph is refused rather than stored as a tag nobody can read. */
export const MAX_TAG_LENGTH = 40;

/** Most tags one contract may carry. A limit only so that a runaway import
 *  cannot put a thousand words in one row's GIN index. */
export const MAX_TAGS = 20;

/**
 * One tag, as it is stored and as it is searched for.
 *
 * Inner whitespace is collapsed rather than removed: "gamla iDét" stays two
 * words, because a tag is a label somebody reads, not an identifier.
 */
export function normaliseTag(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").toLocaleLowerCase("sv-SE").slice(0, MAX_TAG_LENGTH);
}

/**
 * A whole tag list: normalised, emptied of blanks, de-duplicated, capped.
 *
 * Order is the order they were given, minus the duplicates. Not sorted: the
 * person typing them put the important one first often enough that keeping it
 * there is worth more than a tidy list.
 */
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
