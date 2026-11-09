/** A URL with its query and fragment taken off, and no trailing slash. */
export function routePath(url: string): string {
  const path = url.split("#")[0].split("?")[0];
  // "/expenses/" and "/expenses" are the same page to the router.
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}

/**
 * Which of `routes` owns `path`: the longest one it sits under, or null. Longest, not first, because a route can be a
 * prefix of another without being its parent (/stock vs /stock/events). The `${route}/` boundary keeps a future
 * /stockholm out. Null for pages under a section (/profile, an utlägg) that carry their own heading.
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
 * Which section a page is lit under, given the one the previous page was lit under. A page that is not a nav route
 * (an utlägg, its booking form) keeps the section you came from, and so does the next nested page. A nav route is
 * always its own section; with nothing before it (a shared link, a reload) a page is lit by its URL.
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
