// The free labels a product carries: "whisky", "cognac", "vodka".
//
// A tag is nothing but text, and text typed twice is text spelled two ways.
// There is no table of tags to keep them honest (see the schema note on
// StockProduct.tags): what the picker offers is what the products already say,
// so the whole of "is this the same tag" lives here, and both ends use it. The
// route folds what it is sent before it stores it, and the picker folds what it
// is offering before it decides whether what somebody typed is new.
//
// Folding is case and surrounding space, nothing cleverer. "Whisky" and
// "whisky " are the same tag; "whisky" and "whiskey" are two, which is right:
// they are two words, and the shelf may well carry both.

/** How long one may be. Not a rule about language, a floor under how wide a
 *  chip can get before the row it sits in stops reading as a row. */
export const MAX_TAG = 24;
/** How many one product may carry. A product wearing fifteen labels is not
 *  being described, it is being catalogued twice. */
export const MAX_TAGS = 10;

/** The comparison form. Never stored, never shown: a tag keeps the spelling it
 *  was given, and this is only what decides whether two of them are one. */
export const fold = (tag: string): string => tag.trim().toLowerCase();

/**
 * A list of tags as it should be stored: trimmed, emptied of blanks, and with
 * each tag kept once.
 *
 * The first spelling wins, so a product that already says "Whisky" keeps its
 * capital when the same word arrives again in lower case. Sorted, so the order
 * is the same wherever the list is read and an edit that only reorders is not
 * an edit at all.
 */
export function cleanTags(tags: readonly string[]): string[] {
  const seen = new Map<string, string>();
  for (const raw of tags) {
    const tag = raw.trim().replace(/\s+/g, " ");
    if (tag === "") continue;
    const key = fold(tag);
    if (!seen.has(key)) seen.set(key, tag);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, "sv"));
}

/** Whether a list already carries a tag, whatever either of them is spelled
 *  like. */
export const hasTag = (tags: readonly string[], tag: string): boolean =>
  tags.some((t) => fold(t) === fold(tag));

/**
 * Every tag in use, once each, in the order a picker should offer them.
 *
 * Taken from the products themselves, which is the only place tags exist. Where
 * a tag is spelled two ways across two products (one of them made before the
 * folding above, or by an import) the first is what the list carries: the point
 * of the list is to stop a third spelling being invented, not to correct the
 * two that are there.
 */
export const tagsInUse = (products: readonly { tags: string[] }[]): string[] =>
  cleanTags(products.flatMap((p) => p.tags));
