"use client";

import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { usePathname, useSearchParams } from "next/navigation";

import { SECTION_LABELS } from "./app-shell";
import { useHistoryGo, useProgressRouter } from "./route-progress";
import {
  applyNav,
  backTarget,
  EMPTY_STACK,
  returnTarget,
  type BackTarget,
  type NavStack,
} from "@/lib/ui/history-stack";
import { noteIntent, takeIntent } from "@/lib/ui/nav-intent";

// Where you have been on this trip, the one thing the App Router will not
// tell you, and the one thing a "← Utlägg" link needs to be honest.
//
// The problem it solves: a list keeps its state in the query string (which
// scope, which tab, what was searched, which page. See lib/data/list-query),
// and a back link that names a route throws all of it away. Open an utlägg
// from "Alla" and the way back landed you in "Mina", looking at a different
// list from the one you left.
//
// Module state and a subscription rather than a context, exactly as the
// progress bar next door does it: one recorder is mounted beside the bar, and
// anything that wants an answer reads it without a provider wrapped around the
// app. The stack itself, what a move does to it, and what a back link should
// make of it, is lib/ui/history-stack, which is pure and has the tests.

let stack: NavStack = EMPTY_STACK;
const listeners = new Set<() => void>();

// Set by `returnTo` below, consumed by the recorder once the navigation it
// describes has landed. A mutation that pops back to a page it just changed
// would otherwise be shown the router's cached render of that page. The
// utlägg as it was before it was booked. It cannot simply call `refresh()`
// itself: `refresh` acts on the route you are currently on, and at the moment
// a mutation calls it that is still the page being left.
let refreshOnArrival = false;

// The browser keeps the session history across a reload. Every entry a back
// link might jump to is still there and `history.go` still reaches it. All
// that a reload actually loses is *our* memory of what those entries were, and
// that is what this restores. Nothing here is a source of truth: it is only
// believed when the entry it claims we are on is the URL we are actually on.
const STORAGE_KEY = "utlagg:nav-stack";

function restore(): NavStack {
  if (typeof window === "undefined") return EMPTY_STACK;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_STACK;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return EMPTY_STACK;
    const { entries, index } = parsed as Partial<NavStack>;
    if (!Array.isArray(entries) || !entries.every((e) => typeof e === "string")) return EMPTY_STACK;
    if (typeof index !== "number" || index < 0 || index >= entries.length) return EMPTY_STACK;
    // The stack we stored describes a history we are no longer standing in.
    if (entries[index] !== window.location.pathname + window.location.search) return EMPTY_STACK;
    return { entries, index };
  } catch {
    // Private mode, a cleared store, a half-written value: none of them are
    // worth a broken back link, and starting empty is the reload behaviour we
    // had before any of this was persisted.
    return EMPTY_STACK;
  }
}

// At module scope rather than in an effect, so the first client render already
// has it. A back link's *text* changes with the stack, and reading it one
// render late is a visible flicker from "← Utlägg" to "← Bokföring".
stack = restore();

function persist() {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(stack));
  } catch {
    // Nothing to do and nothing worth telling anyone: the stack in memory is
    // the one being used, and this is only the copy that survives a reload.
  }
}

/** Note a route as visited, in whatever way it was arrived at. */
function record(url: string) {
  const next = applyNav(stack, url, takeIntent());
  if (next === stack) return;
  stack = next;
  persist();
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

const getStack = () => stack;
// A server render has no history at all, and must not read module state that a
// previous request left behind.
const getServerStack = () => EMPTY_STACK;

const sectionLabel = (path: string): string | null => SECTION_LABELS[path] ?? null;

function useNavStack(): NavStack {
  return useSyncExternalStore(subscribe, getStack, getServerStack);
}

/** Mounted once, next to the progress bar. Renders nothing. */
export function RouteHistoryRecorder() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const url = search ? `${pathname}?${search}` : pathname;
  const router = useProgressRouter();

  // The browser's own Back and Forward, and every `router.back()` in the app,
  // arrive here and nowhere else. Without this a Back press is recorded as a
  // move forward, and the page you just left becomes the page you came from.
  useEffect(() => {
    const onPop = () => noteIntent("pop");
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    record(url);
    if (!refreshOnArrival) return;
    refreshOnArrival = false;
    // Now that the URL is the destination's, `refresh` acts on the destination.
    router.refresh();
  }, [url, router]);

  return null;
}

/**
 * Where this page's "← <parent>" link should go, given where you have been,
 * and how many history entries back that is. Null when there is nothing behind
 * you that qualifies and the declared parent is the answer. See
 * lib/ui/history-stack's `backTarget` for the rule.
 */
export function useBackTarget(href: string): BackTarget | null {
  const stack = useNavStack();
  return useMemo(() => backTarget(stack, href, sectionLabel), [stack, href]);
}

/**
 * "Put me back where this started", for a mutation that has finished and has
 * nowhere left to be: a booked utlägg returning to the utlägg, a deleted one
 * returning to the list.
 *
 * It pops when the destination is genuinely just behind, which leaves the
 * history stack the length it was and restores the scroll position and the
 * page you were looking at; and replaces when it is not, which is the case for
 * something that did not exist until a moment ago (the wizard's new utlägg).
 * Never a push. A push is what left the form you just submitted sitting on the
 * Back button, and the deleted utlägg sitting there behind its own list.
 *
 * Either way the destination is refreshed once it is reached. See
 * `refreshOnArrival`.
 */
export function useReturnTo(): (href: string) => void {
  const stack = useNavStack();
  const router = useProgressRouter();
  const go = useHistoryGo();

  return useCallback(
    (href: string) => {
      refreshOnArrival = true;
      const target = returnTarget(stack, href);
      if (target) go(target.delta);
      else router.replace(href);
    },
    [stack, router, go],
  );
}
