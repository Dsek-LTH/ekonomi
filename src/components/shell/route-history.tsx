"use client";

import { useEffect, useSyncExternalStore } from "react";
import { usePathname, useSearchParams } from "next/navigation";

import { SECTION_LABELS } from "./app-shell";
import { routePath } from "@/lib/ui/routes";

// Where you were before this page — the one thing the App Router will not tell
// you, and the one thing a "← Utlägg" link needs to be honest.
//
// The problem it solves: a list keeps its state in the query string (which
// scope, which tab, what was searched, which page — see lib/data/list-query),
// and a back link that names a route throws all of it away. Open an utlägg from
// "Alla" and the way back landed you in "Mina", looking at a different list
// from the one you left.
//
// Module state and a subscription rather than a context, exactly as the
// progress bar next door does it: one recorder is mounted beside the bar, and
// anything that wants the answer reads it without a provider wrapped around the
// app. Nothing is persisted — this is about the trip you are on, and a reload
// legitimately has no previous page (see BackLink, which falls back to the
// route it names).

let previous: string | null = null;
let current: string | null = null;
// The last *section* you were in — Bokföring, Attest, Utlägg — as opposed to
// the last page. They differ as soon as you go two deep: opening an utlägg from
// Bokföring and then its booking screen leaves the previous page pointing at
// the utlägg, while the list you came from is still Bokföring. That list is
// what a back link should offer, and it is what survives the trip.
let section: { url: string; label: string } | null = null;
const listeners = new Set<() => void>();

/**
 * Note a route as visited. Repeats are ignored: `router.refresh()` re-renders
 * without changing the URL, and treating that as a move would make the page
 * its own previous page.
 */
function record(url: string) {
  if (url === current) return;
  previous = current;
  current = url;
  const label = SECTION_LABELS[routePath(url)];
  if (label) section = { url, label };
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

const getPrevious = () => previous;
const getSection = () => section;
// A server render has no history at all, and must not read module state that a
// previous request left behind.
const nothing = () => null;

/** Mounted once, next to the progress bar. Renders nothing. */
export function RouteHistoryRecorder() {
  const pathname = usePathname();
  const search = useSearchParams().toString();

  useEffect(() => {
    record(search ? `${pathname}?${search}` : pathname);
  }, [pathname, search]);

  return null;
}

/** The page visited before this one, with its query string, or null. */
export function usePreviousRoute(): string | null {
  return useSyncExternalStore(subscribe, getPrevious, nothing);
}

/**
 * The last section of the app you were in — its URL, and the `nav` message key
 * that names it. Null before you have been in one.
 *
 * Note that it is the *URL*, query and all: a section is a list, and a list
 * keeps which slice of it you were looking at in the query string.
 */
export function useLastSection(): { url: string; label: string } | null {
  return useSyncExternalStore(subscribe, getSection, nothing);
}
