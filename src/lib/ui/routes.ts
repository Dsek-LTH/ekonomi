/**
 * Do two URLs name the same route, whatever either carries after it?
 *
 * The question a back link asks: "/expenses" and "/expenses?view=ALL&page=2"
 * are one route and two screens, and a link that names the first should return
 * you to the second when that is where you came from. See
 * components/back-link.tsx.
 *
 * Paths only — both sides are app-relative, and a link that pointed off-site
 * would not be a back link.
 */
export function samePath(a: string, b: string): boolean {
  return routePath(a) === routePath(b);
}

/** A URL with its query and fragment taken off, and no trailing slash. */
export function routePath(url: string): string {
  const path = url.split("#")[0].split("?")[0];
  // "/expenses/" and "/expenses" are the same page to the router, and only one
  // of the two is ever typed by hand.
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}
