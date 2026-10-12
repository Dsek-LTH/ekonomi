// Systembolaget's article number, and getting it out of what somebody pastes.
//
// The number is not printed on the tin. Where it is found is a product page,
// and what a person has in hand when they go looking for it is that page's
// address:
//
//   https://www.systembolaget.se/produkt/ol/norrlands-guld-141215/
//                                                            ^^^^^^
//
// So the field takes either. Asking for the digits alone would mean reading
// them off the end of a URL by eye, which is the same error-prone transcription
// the barcode scanner exists to avoid one field further up.

/** What a stored article number may look like. Systembolaget's are 4–7 digits
 *  today; the range is loose because the format is theirs to change. */
const ARTICLE_NUMBER = /^\d{3,10}$/;

/**
 * The article number in whatever was pasted, or null if there isn't one.
 *
 * Accepts the bare number, a full product URL, or just the slug. The digits are
 * taken from the *end* rather than by matching the whole string: a slug may
 * carry digits of its own (`brooklyn-1-2-3-141215`, `carlsberg-33cl-108512`)
 * and the article number is the last run in every case.
 *
 * A trailing slash, a query string and a fragment are all ignored, since a URL
 * copied from a browser's address bar arrives with whatever the site put there.
 */
export function parseSystembolagetId(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  if (ARTICLE_NUMBER.test(trimmed)) return trimmed;

  // Cut the query and fragment before looking for the last digits. A `?` or a
  // `#` may be followed by numbers that have nothing to do with the article.
  const path = trimmed.split(/[?#]/)[0]!.replace(/\/+$/, "");
  const runs = path.match(/\d+/g);
  const last = runs?.[runs.length - 1];
  return last && ARTICLE_NUMBER.test(last) ? last : null;
}

/**
 * The product's page on systembolaget.se, or null when there is nothing to
 * link to.
 *
 * Built from the article number alone, without the slug the canonical URL also
 * carries (`/produkt/{id}` is not a route the site serves), so this goes
 * through their search instead, which resolves an article number to its
 * product. One redirect more than a stored URL would cost, and it cannot rot
 * the way a stored slug does when a product is renamed.
 */
export function systembolagetSearchUrl(id: string): string | null {
  return ARTICLE_NUMBER.test(id)
    ? `https://www.systembolaget.se/sok?textQuery=${encodeURIComponent(id)}`
    : null;
}
