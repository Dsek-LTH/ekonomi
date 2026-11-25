"use client";

import { useCallback, useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";

import { useHistoryGo, useProgressRouter } from "./route-progress";
import { routePath } from "@/lib/ui/routes";

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

let movedSinceLoad = false;
let firstUrl: string | null = null;

function canGoBackInApp(): boolean {
  const nav = navigationApi();
  if (nav) return nav.canGoBack;
  return movedSinceLoad;
}

/** Whether the history entry right behind this one is `path`. False without the Navigation API. */
function parentIsBehind(path: string): boolean {
  const nav = navigationApi();
  const current = nav?.currentEntry;
  if (!nav || !current) return false;
  const url = nav.entries()[current.index - 1]?.url;
  return Boolean(url) && routePath(new URL(url!).pathname) === path;
}

let refreshOnArrival = false;

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
    router.refresh();
  }, [url, router]);

  return null;
}

/**
 * Go up to `parent`: the one way back in the app, for the back arrow and for every finished step (a saved kontering,
 * a deleted utlägg). Back in history when the parent is the entry right behind, which keeps its tab and scroll,
 * otherwise in place of this page. Either way nothing spent is left in the history for Back to land in, and the
 * parent is fetched again on arrival, since this page may have changed what it shows.
 *
 * "Up" is the page's parent, never wherever you came from: a record opened from Översikt goes up to its list (the
 * browser's own Back still returns to Översikt). Without the Navigation API (no history to read) it always replaces.
 */
export function useGoUp(): (parent: string) => void {
  const router = useProgressRouter();
  const go = useHistoryGo();
  return useCallback(
    (parent: string) => {
      if (parentIsBehind(routePath(parent))) {
        refreshOnArrival = true;
        go(1);
      } else {
        router.replace(parent);
      }
    },
    [router, go],
  );
}

/**
 * Closing an overlay (the settings), which is not going up: back to the page it opened over, or `fallback` when it
 * was opened directly.
 */
export function useCloseOverlay(fallback: string): { href: string; close: () => void } {
  const router = useProgressRouter();
  const close = useCallback(() => {
    if (canGoBackInApp()) router.back();
    else router.push(fallback);
  }, [router, fallback]);
  return { href: fallback, close };
}
