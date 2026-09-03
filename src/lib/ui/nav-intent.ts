import { urlKey } from "./routes";

/**
 * What kind of navigation is currently in flight, and where it is going.
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

// The note carries the address it is about, and is believed only by the
// arrival at that address. A bare intent was read by whatever navigation
// happened to land next, and two ordinary things left one lying around:
//
//   a replace to the address you are already at (clicking "Alla" while the
//   list is already showing Alla) changes no URL, so nothing ever arrives to
//   consume the note
//   the search box commits on a timer, and that timer can fire just after a
//   row was clicked, which states "replace" about a navigation that is already
//   on its way somewhere else
//
// Either way the next push, into an utlägg, was recorded as a replace: the
// list you came from was overwritten in the stack by the page you had opened,
// and the back link, finding no list behind it, fell back to the bare route
// and dropped you in Mina. See lib/ui/history-stack.
const INTENT_TTL_MS = 10_000;

let pending: { intent: NavIntent; url: string; at: number } | null = null;

/** Say what the navigation about to happen is, and where it is going. */
export function noteIntent(intent: NavIntent, url: string): void {
  pending = { intent, url: urlKey(url), at: Date.now() };
}

/**
 * The intent behind an arrival at `url`, clearing the note either way.
 *
 * "push" when nothing was said, when what was said was about somewhere else,
 * or when it was said so long ago that the navigation it described plainly
 * never happened. The TTL is generous because every page in this app is a
 * database round trip, and a slow replace is still a replace.
 */
export function takeIntent(url: string): NavIntent {
  const note = pending;
  pending = null;
  if (!note || Date.now() - note.at > INTENT_TTL_MS) return "push";
  return note.url === urlKey(url) ? note.intent : "push";
}
