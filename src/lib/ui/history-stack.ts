import type { NavIntent } from "./nav-intent";
import { routePath, samePath } from "./routes";

// The trip you are on, as a stack with a finger on it — the thing the App
// Router will not tell you and a back link cannot be honest without.
//
// What stood here before was two slots: the page before this one, and the last
// section you were in. Two slots cannot express "three pages back", so a back
// link two deep gave up on history and pushed the route forward instead,
// landing you at the top of a freshly fetched list and leaving the page you
// came from sitting in front of you on the Back button. They also could not
// tell a push from a replace, so narrowing a list — which this app does with
// `replace`, see lib/data/use-list-query — moved the "previous page" to a URL
// that was never a history entry at all.
//
// An index into a list of URLs says both things at once: which entry you are
// on, and how many steps back anything behind you is. `history.go(-delta)`
// then reaches it in one move at any depth, which is what restores the scroll
// position and the router's cached render of the page.
//
// Pure and DOM-free on purpose: everything here is a function of a stack, a
// URL and an intent, so the whole of it is testable without a browser. The
// live one lives in components/shell/route-history.

export interface NavStack {
  /** Every URL of this trip, oldest first, each with its query string. */
  entries: string[];
  /** Which one we are on. -1 before anything has been recorded. */
  index: number;
}

export const EMPTY_STACK: NavStack = { entries: [], index: -1 };

// A long trip is still one trip, but nothing reads further back than the scan
// limits below, and the whole thing is written to sessionStorage on every
// move. The oldest entries fall off the front, which leaves every delta
// between the remaining entries exactly as it was.
const MAX_ENTRIES = 50;

// How far back a back link will look for somewhere to return to. Past this,
// whatever it finds is not "where you came from" in any sense a reader would
// recognise, and the page's own declared parent is the better answer.
const BACK_SCAN_LIMIT = 10;

// The same question asked by a finished mutation, and asked much more
// narrowly: "is the page I want to return to the one just behind me?" A booked
// utlägg is one step back, a deleted one's list is one or two. Anything
// further is a coincidence, not a return.
const RETURN_SCAN_LIMIT = 3;

/**
 * The stack after a navigation to `url` of the given kind.
 *
 * Returns the stack it was given, unchanged and identical, when nothing moved
 * — the caller uses that to skip a notification, and `useSyncExternalStore`
 * requires the identity to be stable when the value is.
 */
export function applyNav(stack: NavStack, url: string, intent: NavIntent): NavStack {
  // Nothing recorded yet: this is where the trip starts, whatever brought us.
  if (stack.index < 0) return { entries: [url], index: 0 };

  // The URL we are already on. `router.refresh()` re-renders without moving,
  // and treating that as a move would make the page its own previous page.
  if (url === stack.entries[stack.index]) return stack;

  if (intent === "replace") {
    const entries = stack.entries.slice();
    entries[stack.index] = url;
    return { entries, index: stack.index };
  }

  if (intent === "pop") {
    const found = nearestIndex(stack, url);
    // Somewhere we never recorded — a Back press out of a trip that began
    // before this tab loaded us, most likely. The entries we hold no longer
    // describe the browser's history, and deltas measured against them would
    // send the next Back press somewhere arbitrary. Start again from here,
    // which costs a back link its query string and never lies.
    return found < 0 ? { entries: [url], index: 0 } : { entries: stack.entries, index: found };
  }

  // A push drops whatever was ahead of us, exactly as the browser does.
  const entries = stack.entries.slice(0, stack.index + 1);
  entries.push(url);
  const overflow = Math.max(0, entries.length - MAX_ENTRIES);
  return {
    entries: overflow ? entries.slice(overflow) : entries,
    index: entries.length - 1 - overflow,
  };
}

/**
 * Where a popped-to URL sits in the stack, searching outwards from where we
 * think we are and preferring backwards — Back is pressed more than Forward,
 * and a URL can legitimately appear in the stack twice.
 */
function nearestIndex(stack: NavStack, url: string): number {
  for (let d = 1; d <= stack.entries.length; d++) {
    if (stack.entries[stack.index - d] === url) return stack.index - d;
    if (stack.entries[stack.index + d] === url) return stack.index + d;
  }
  return -1;
}

export interface BackTarget {
  /** The entry to return to, query and all. */
  url: string;
  /** How many history entries back it is. Always at least 1. */
  delta: number;
  /**
   * The nav's name for it, when what we found was a section rather than the
   * declared parent itself. Null means the caller's own label already names
   * this destination correctly.
   */
  section: string | null;
}

/**
 * Where a "← <parent>" link should actually go, given where you have been.
 *
 * The nearest entry behind you that either *is* the declared parent, or — when
 * the declared parent is a section of the app — is any section. A nested page
 * has more than one parent in practice: an utlägg is opened from Utlägg, from
 * Attest, from Bokföring and from Översikt, and the page can only name one of
 * them. The stack knows which one you used.
 *
 * Nearest-first, so the section you came through beats the one you passed
 * through before it, and "the list I just left" beats a stale memory of some
 * other list. Null when there is nothing behind you that qualifies — a link
 * someone sent you, a reload beyond what we could restore — and the page's own
 * declared parent is then the right answer, pushed rather than popped.
 *
 * `sectionLabel` is injected rather than imported so this file stays free of
 * the nav (and of React); the live caller passes app-shell's SECTION_LABELS.
 */
export function backTarget(
  stack: NavStack,
  href: string,
  sectionLabel: (path: string) => string | null,
): BackTarget | null {
  // Only when the declared parent is a list to begin with. The booking
  // screen's parent is one utlägg, and "a section you came through" is not a
  // substitute for it — you would be sent past the thing you were working on.
  const parentIsSection = sectionLabel(routePath(href)) !== null;
  const stop = Math.max(0, stack.index - BACK_SCAN_LIMIT);

  for (let i = stack.index - 1; i >= stop; i--) {
    const entry = stack.entries[i];
    if (samePath(entry, href)) return { url: entry, delta: stack.index - i, section: null };
    if (parentIsSection) {
      const section = sectionLabel(routePath(entry));
      if (section) return { url: entry, delta: stack.index - i, section };
    }
  }
  return null;
}

/**
 * Where a finished mutation should return to: the same route, if it is close
 * enough behind that returning is what popping means. Null when it is not, and
 * the caller replaces the entry it is standing on instead.
 *
 * Narrower than a back link on purpose — see RETURN_SCAN_LIMIT.
 */
export function returnTarget(stack: NavStack, href: string): { url: string; delta: number } | null {
  const stop = Math.max(0, stack.index - RETURN_SCAN_LIMIT);
  for (let i = stack.index - 1; i >= stop; i--) {
    if (samePath(stack.entries[i], href)) return { url: stack.entries[i], delta: stack.index - i };
  }
  return null;
}
