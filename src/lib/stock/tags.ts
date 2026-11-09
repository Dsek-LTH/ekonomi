// Free product tags. Tags are plain text, so "same tag" means equal after trim and lowercase,
// used by both the route and the picker. "whisky" and "whiskey" stay two.

/** Max length of one tag. */
export const MAX_TAG = 24;
/** Max tags per product. */
export const MAX_TAGS = 10;

/** Comparison form only. A tag keeps the spelling it was given. */
const fold = (tag: string): string => tag.trim().toLowerCase();

/** Trimmed, blanks removed, deduplicated (first spelling wins) and sorted. */
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

/** Whether a list carries a tag, ignoring case and spacing. */
export const hasTag = (tags: readonly string[], tag: string): boolean =>
  tags.some((t) => fold(t) === fold(tag));

/** Every tag in use, once each, taken from the products (there is no tag table). */
export const tagsInUse = (products: readonly { tags: string[] }[]): string[] =>
  cleanTags(products.flatMap((p) => p.tags));
