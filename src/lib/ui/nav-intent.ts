/**
 * What kind of navigation is currently in flight.
 *
 * The App Router tells you that the URL changed and nothing whatsoever about
 * how it changed: a push, a replace and a Back press all arrive as the same
 * new value out of `usePathname()`. Three things that are not the same thing:
 * a push adds a history entry, a replace overwrites the one you are on, and a
 * pop moves through entries that already exist. A stack that guesses gets all
 * three wrong the moment a list writes its filters into the query string with
 * `replace` (see lib/data/use-list-query), which this app does constantly.
 *
 * So the intent is *stated* rather than inferred, at the two places every
 * navigation in this app already passes through: `useProgressRouter`, which
 * wraps `replace`, and a `popstate` listener for the browser's own buttons.
 * Everything else (a `<Link>` click, a `push`) is a push, which is why that
 * is the default and why nothing had to be threaded through the link tree.
 *
 * A latch rather than an argument because the two ends are far apart: the
 * router is called in a click handler, and the URL it produces is observed one
 * render later by the recorder in the app layout.
 */
export type NavIntent = "push" | "replace" | "pop";

// A stated intent is only good for the navigation it was stated about. If the
// URL never changes (`router.replace` to the address you are already at, a
// popstate the router declines to act on) the note is left behind, and
// applying it to whatever happens next would be worse than not having it.
// Long enough to cover a navigation that has to reach the database, which
// every page in this app does.
const INTENT_TTL_MS = 3_000;

let pending: { intent: NavIntent; at: number } | null = null;

/** Say what the navigation about to happen is. */
export function noteIntent(intent: NavIntent): void {
  pending = { intent, at: Date.now() };
}

/** Read and clear it. "push" when nothing was said, or said too long ago. */
export function takeIntent(): NavIntent {
  const note = pending;
  pending = null;
  if (!note || Date.now() - note.at > INTENT_TTL_MS) return "push";
  return note.intent;
}
