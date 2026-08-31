"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { noteIntent } from "@/lib/ui/nav-intent";

// Whatever `useRouter()` hands back, rather than reaching into next/dist for
// the name of it. The wrapper below has to stay a drop-in for exactly that.
type Router = ReturnType<typeof useRouter>;

// Every page in this app is a Server Component rendered against a live database
// (`dynamic = "force-dynamic"` on the app layout), so a navigation is a network
// round trip, not a re-render. The route skeletons cover the destination; this
// covers the gap before the destination exists at all, and the refreshes that
// never change route: a mutation's `router.refresh()`, a filter written into
// the query string, where no skeleton is ever shown.
//
// Two things can hold the bar up, because navigations start two different ways:
//
//   a <Link> click, caught in the DOM, released when the URL changes
//   router.push / replace / refresh, wrapped in a transition by the hook
//     below, released when React says the transition is done
//
// Both go through one counter so overlapping navigations can't switch it off
// early. Nothing else in the app has to know about any of it: pages call the
// router the way they already did, through `useProgressRouter`.

let holds = 0;
const listeners = new Set<() => void>();

/**
 * Mark a navigation as in flight. Returns the release. Call it exactly once
 * when the navigation lands; calling it twice is safe and does nothing.
 */
export function startRouteProgress(): () => void {
  holds += 1;
  listeners.forEach((l) => l());
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds -= 1;
    listeners.forEach((l) => l());
  };
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

// The bar is a client-only affordance; the server always renders it idle, and
// the store is module state that a server render must not read.
const isNavigating = () => holds > 0;
const notNavigating = () => false;

// Long enough that a cached, already-prefetched route doesn't flash a bar on
// its way in; short enough that a real database round trip is never silent.
const SHOW_AFTER_MS = 140;
// Where the creep stops. It cannot reach the end on its own. The bar is not
// measuring anything, it is saying "still working", and a bar that sits at 100%
// while nothing happens is a worse lie than one that sits at 90%.
const CEILING = 92;
const CREEP_MS = 160;
// A full page load, a route that throws, a link the router declines to follow:
// none of those ever release their hold, and a bar stuck across the top of the
// app forever is worse than one that gives up.
const ABANDON_MS = 20_000;

export function RouteProgress() {
  const active = useSyncExternalStore(subscribe, isNavigating, notNavigating);
  // Only the creep is state. Finishing is a render of `active`, not a write:
  // the bar is at 100% precisely when it is shown and nothing is in flight, so
  // storing that separately would be storing something already known.
  const [{ shown, creep }, set] = useState({ shown: false, creep: 0 });

  useEffect(() => {
    if (!active) {
      // Nothing was ever shown for this navigation. It landed inside the delay
      // above, which is exactly what the delay is for.
      if (!shown) return;
      // The render below is already holding it at 100%; this clears it after the
      // width and fade have played.
      const clear = setTimeout(() => set({ shown: false, creep: 0 }), 240);
      return () => clearTimeout(clear);
    }

    const appear = setTimeout(() => set({ shown: true, creep: 10 }), SHOW_AFTER_MS);
    // Asymptotic, so a slow request keeps producing movement without the bar
    // ever claiming to be nearly finished.
    const tick = setInterval(() => {
      set((s) => (s.shown ? { shown: true, creep: s.creep + (CEILING - s.creep) * 0.12 } : s));
    }, CREEP_MS);
    return () => {
      clearTimeout(appear);
      clearInterval(tick);
    };
    // `shown` is read but deliberately not a dependency: it changes on every
    // tick, and re-running this effect would restart the delay each time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  if (!shown) return null;

  const value = active ? creep : 100;

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5 print:hidden"
    >
      <div
        className="h-full rounded-r-full bg-brand shadow-[0_0_10px_var(--color-brand)] transition-[width,opacity] duration-200 ease-[var(--ease-out-quint)]"
        style={{ width: `${value}%`, opacity: active ? 1 : 0 }}
      />
    </div>
  );
}

/**
 * `useRouter()` with the progress bar attached. Same interface, so it is a
 * one-line import swap at the call site.
 *
 * Every navigation goes through a transition, which is what the App Router
 * does for a `<Link>` anyway, and the transition's pending flag is the honest
 * "has it landed" signal. `refresh()` needs it most: it changes no URL, so
 * there is nothing else to watch, and it is the one every mutation ends with.
 */
export function useProgressRouter(): Router {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!pending) return;
    return startRouteProgress();
  }, [pending]);

  return useMemo(
    () => ({
      ...router,
      push: (href, options) => startTransition(() => router.push(href, options)),
      replace: (href, options) =>
        startTransition(() => {
          // The one kind of navigation nothing downstream could work out for
          // itself: it changes the URL without adding a history entry, and a
          // stack that counted it would send every Back press one step wrong.
          // A push needs no such note. See lib/ui/nav-intent.
          noteIntent("replace");
          router.replace(href, options);
        }),
      refresh: () => startTransition(() => router.refresh()),
      back: () => startTransition(() => router.back()),
      forward: () => startTransition(() => router.forward()),
    }),
    // startTransition is stable across renders; router is the only real input.
    [router],
  );
}

/**
 * `history.go(-delta)`, with the progress bar attached and inside a transition
 * The same treatment `useProgressRouter` gives everything else.
 *
 * The router has `back()` and nothing for going back further, and pressing
 * `back()` twice does not do it: the second call is made before the first has
 * landed. One `go` is one navigation, which is what returning to a list you
 * opened two pages ago has to be. See components/back-link.tsx.
 */
export function useHistoryGo(): (delta: number) => void {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!pending) return;
    return startRouteProgress();
  }, [pending]);

  // Positive is backwards, because every caller is going back and none of them
  // should have to write the minus sign to say so.
  return useCallback(
    (delta: number) => {
      startTransition(() => {
        // One step is what the router itself has a word for, and its word is
        // worth using: `back()` dispatches into the router, so the transition
        // above can see it land and the bar can cover the wait. `history.go`
        // only queues a popstate, and the transition it was started in is over
        // before the browser acts on it.
        if (delta <= 1) router.back();
        else window.history.go(-delta);
      });
    },
    [router],
  );
}

/**
 * Watches for `<Link>` navigations, which the hook above never sees. Mounted
 * once, next to the bar itself.
 */
function useLinkNavigations() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const release = useRef<(() => void) | null>(null);

  // The URL changing is the navigation landing. This also runs on mount, when
  // there is nothing to release.
  useEffect(() => {
    release.current?.();
    release.current = null;
  }, [pathname, search]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      // Anything that isn't a plain left click opens elsewhere (a new tab, a
      // new window, a download) and this page is not going anywhere.
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
        return;
      }
      const anchor = (e.target as Element | null)?.closest?.("a");
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;

      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#")) return;

      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      // Same page: the router will no-op, so there is nothing to wait for.
      if (url.pathname === window.location.pathname && url.search === window.location.search) {
        return;
      }

      release.current?.();
      const done = startRouteProgress();
      const abandon = setTimeout(done, ABANDON_MS);
      release.current = () => {
        clearTimeout(abandon);
        done();
      };
    };

    // Capture, so a link whose own handler stops propagation is still seen.
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);
}

/** The bar plus its link listener. Mount once, in the app layout. */
export function RouteProgressBar() {
  useLinkNavigations();
  return <RouteProgress />;
}
