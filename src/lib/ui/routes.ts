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
 * filed under /stock rather than being a page *of* Produkter. A test that stopped
 * at the first match lit both rows and said nothing about which one you were
 * actually on.
 *
 * The `${route}/` boundary makes it a route boundary rather than a string one:
 * without it a future /stockholm would belong to Produkter.
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

/**
 * Which section a page is lit under, given the one the previous page was lit
 * under.
 *
 * A page that is not itself a nav route (an utlägg, its booking form, a
 * product) can be reached from several sections: an utlägg from Utlägg, from
 * Attest, from Bokföring and from Översikt. By its URL it always belongs to
 * Utlägg, so opening one from the attest queue moved the tabs and the sidebar
 * to a section you had not gone to, and Back moved them again. Such a page
 * keeps the section you came to it from instead, and so does the next nested
 * page after it (the booking form, the next utlägg in the queue).
 *
 * A nav route is always its own section: clicking a tab or a row in the
 * sidebar is the way out. With nothing before it (a link someone sent, a
 * reload) a page is lit by its URL, as it always was.
 */
export function carriedSection(
  path: string,
  previous: string | null,
  routes: readonly string[],
): string | null {
  const own = owningRoute(path, routes);
  const p = routePath(path);
  if (routes.includes(p)) return own;
  return previous ?? own;
}
