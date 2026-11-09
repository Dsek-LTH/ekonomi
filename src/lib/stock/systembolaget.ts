// Systembolaget's article number, parsed from what is pasted (usually a product page URL such as
// .../produkt/ol/norrlands-guld-141215/).

/** Systembolaget's are 4-7 digits today; loose because the format is theirs to change. */
const ARTICLE_NUMBER = /^\d{3,10}$/;

/** The article number in a bare number, URL or slug, or null. Taken from the end, since slugs carry digits of their own. */
export function parseSystembolagetId(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  if (ARTICLE_NUMBER.test(trimmed)) return trimmed;

  // Drop query and fragment first, they may carry unrelated numbers.
  const path = trimmed.split(/[?#]/)[0]!.replace(/\/+$/, "");
  const runs = path.match(/\d+/g);
  const last = runs?.[runs.length - 1];
  return last && ARTICLE_NUMBER.test(last) ? last : null;
}

/** Linked through their search, since `/produkt/{id}` is not a route the site serves. */
export function systembolagetSearchUrl(id: string): string | null {
  return ARTICLE_NUMBER.test(id)
    ? `https://www.systembolaget.se/sok?textQuery=${encodeURIComponent(id)}`
    : null;
}
