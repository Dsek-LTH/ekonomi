/**
 * Do two URLs name the same route, whatever either carries after it?
 *
 * The question a back link asks: "/expenses" and "/expenses?view=ALL&page=2"
 * are one route and two screens, and a link that names the first should return
 * you to the second when that is where you came from. See
 * components/back-link.tsx.
 *
 * Paths only. Both sides are app-relative, and a link that pointed off-site
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

/**
 * Which of `routes` owns `path`: the longest one it sits under, or null.
 *
 * The sidebar's rule for what to light up, and the top bar's for what to call
 * where you are. Longest and not first, because a route can be a prefix of
 * another without being its parent: /stock, /stock/events and /stock/log are
 * three sections that share an area of the URL space, and the events list is
 * filed under /stock rather than being a page *of* Lager. A test that stopped
 * at the first match lit both rows and said nothing about which one you were
 * actually on.
 *
 * The `${route}/` boundary makes it a route boundary rather than a string one:
 * without it a future /stockholm would belong to Lager.
 *
 * Null for a path no route owns (/profile, an utlägg's own page). Those are
 * pages under a section rather than sections, and they carry their own heading
 * and back link.
 */
export function owningRoute(path: string, routes: readonly string[]): string | null {
  let best: string | null = null;
  for (const route of routes) {
    if ((path === route || path.startsWith(`${route}/`)) && route.length > (best?.length ?? 0)) {
      best = route;
    }
  }
  return best;
}
