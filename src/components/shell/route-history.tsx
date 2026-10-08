"use client";

import { useCallback, useEffect } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { usePathname, useSearchParams } from "next/navigation";

import { useHistoryGo, useProgressRouter } from "./route-progress";
import { routePath } from "@/lib/ui/routes";

// Back buttons do what the browser's Back button does. Nothing more.
//
// What stood here before was a copy of the session history, kept in module
// state and rebuilt from the URL changes the App Router reports. The router
// does not say whether a change was a push, a replace or a pop, so the copy
// had to guess. It guessed wrong for every replace that went past our own
// router wrapper (a server `redirect()`, Next's own replaces), and for a Back
// or Forward press onto a URL that was in the history twice. Once wrong, a
// back link sent `history.go(-n)` into the real history with the copy's `n`,
// and you landed somewhere else entirely.
//
// The browser already knows where you have been. Where it will tell us (the
// Navigation API), we ask it. Where it will not, we only need one bit: has
// this tab moved inside the app since it loaded.

// The parts of the Navigation API this file reads. TypeScript's DOM library
// does not describe it yet.
interface NavigationEntryLike {
  url: string | null;
  index: number;
}
interface NavigationLike {
  canGoBack: boolean;
  currentEntry: NavigationEntryLike | null;
  entries(): NavigationEntryLike[];
}

function navigationApi(): NavigationLike | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { navigation?: NavigationLike }).navigation ?? null;
}

// For a browser without the Navigation API. Set once the URL has changed since
// the page loaded. Coarse (Back to the first page and the flag stays set), but
// it is only the fallback.
let movedSinceLoad = false;
let firstUrl: string | null = null;

/**
 * Whether going back stays in the app. The Navigation API lists only entries
 * of this origin, so `canGoBack` is exactly that question.
 */
function canGoBackInApp(): boolean {
  const nav = navigationApi();
  if (nav) return nav.canGoBack;
  return movedSinceLoad;
}

/**
 * How many entries back the nearest one whose path is `path` sits, looking no
 * further than `limit`. Null when there is none, or when the browser will not
 * show us its history.
 */
function stepsBackTo(path: string, limit: number): number | null {
  const nav = navigationApi();
  const current = nav?.currentEntry;
  if (!nav || !current) return null;
  const entries = nav.entries();
  for (let d = 1; d <= limit; d++) {
    const url = entries[current.index - d]?.url;
    if (!url) return null;
    if (routePath(new URL(url).pathname) === path) return d;
  }
  return null;
}

// Set by `returnTo` below, consumed once the navigation it describes has
// landed. A mutation that goes back to a page it just changed would otherwise
// be shown the router's cached render of that page: the utlägg as it was
// before it was booked. It cannot simply call `refresh()` itself. `refresh`
// acts on the route you are currently on, and at that moment that is still
// the page being left.
let refreshOnArrival = false;

/** Mounted once, next to the progress bar. Renders nothing. */
export function RouteHistoryRecorder() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const url = search ? `${pathname}?${search}` : pathname;
  const router = useProgressRouter();

  useEffect(() => {
    if (firstUrl === null) firstUrl = url;
    else if (url !== firstUrl) movedSinceLoad = true;
    if (!refreshOnArrival) return;
    refreshOnArrival = false;
    // Now that the URL is the destination's, `refresh` acts on the destination.
    router.refresh();
  }, [url, router]);

  return null;
}

/**
 * A back button: the browser's Back when there is somewhere in the app behind
 * you, and `fallback` when there is not (a link someone sent you, a fresh
 * tab). `href` is what a middle click or a new tab opens.
 */
export function useGoBack(fallback: string): {
  href: string;
  onClick: (e: ReactMouseEvent<HTMLAnchorElement>) => void;
  /** The same, for a caller with no click event: Escape closing an overlay. */
  goBack: () => void;
} {
  const router = useProgressRouter();

  const goBack = useCallback(() => {
    if (canGoBackInApp()) router.back();
    else router.push(fallback);
  }, [router, fallback]);

  return {
    href: fallback,
    onClick: (e) => {
      // Anything but a plain left click is opening this elsewhere, and the
      // href is what should be opened.
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
        return;
      }
      e.preventDefault();
      goBack();
    },
    goBack,
  };
}

// A booked utlägg is one step back from the booking screen, a deleted one's
// list is one or two. Anything further is a coincidence, not a return.
const RETURN_SCAN_LIMIT = 3;

/**
 * "Put me back where this started", for a mutation that has finished and has
 * nowhere left to be: a booked utlägg returning to the utlägg, a deleted one
 * returning to the list.
 *
 * Goes back when the destination is just behind in the browser's history,
 * which keeps the history the length it was and restores the scroll position
 * and the list's query. Replaces when it is not, which is the case for
 * something that did not exist until a moment ago (the wizard's new utlägg).
 * Never a push. A push is what left the form you just submitted sitting on the
 * Back button.
 *
 * Either way the destination is refreshed once it is reached. See
 * `refreshOnArrival`.
 */
export function useReturnTo(): (href: string) => void {
  const router = useProgressRouter();
  const go = useHistoryGo();

  return useCallback(
    (href: string) => {
      refreshOnArrival = true;
      const steps = stepsBackTo(routePath(href), RETURN_SCAN_LIMIT);
      if (steps) go(steps);
      else router.replace(href);
    },
    [router, go],
  );
}
