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

type Router = ReturnType<typeof useRouter>;

let holds = 0;
const listeners = new Set<() => void>();

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

// The bar is a client-only affordance; the server always renders it idle, and the
// store is module state that a server render must not read.
const isNavigating = () => holds > 0;
const notNavigating = () => false;

const SHOW_AFTER_MS = 140;
const CEILING = 92;
const CREEP_MS = 160;
const ABANDON_MS = 20_000;

function RouteProgress() {
  const active = useSyncExternalStore(subscribe, isNavigating, notNavigating);
  const [{ shown, creep }, set] = useState({ shown: false, creep: 0 });

  useEffect(() => {
    if (!active) {
      if (!shown) return;
      const clear = setTimeout(() => set({ shown: false, creep: 0 }), 240);
      return () => clearTimeout(clear);
    }

    const appear = setTimeout(() => set({ shown: true, creep: 10 }), SHOW_AFTER_MS);
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
    <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5 print:hidden">
      <div
        className="h-full bg-linear-to-r from-action-from to-action-to shadow-[0_0_10px_var(--color-action-to)] transition-[width,opacity] duration-200 ease-[var(--ease-out-quint)]"
        style={{ width: `${value}%`, opacity: active ? 1 : 0 }}
      />
    </div>
  );
}

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
      replace: (href, options) => startTransition(() => router.replace(href, options)),
      refresh: () => startTransition(() => router.refresh()),
      back: () => startTransition(() => router.back()),
      forward: () => startTransition(() => router.forward()),
    }),
    [router],
  );
}

export function useHistoryGo(): (delta: number) => void {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!pending) return;
    return startRouteProgress();
  }, [pending]);

  return useCallback(
    (delta: number) => {
      startTransition(() => {
        if (delta <= 1) router.back();
        else window.history.go(-delta);
      });
    },
    [router],
  );
}

function useLinkNavigations() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const release = useRef<(() => void) | null>(null);

  useEffect(() => {
    release.current?.();
    release.current = null;
  }, [pathname, search]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (
        e.defaultPrevented ||
        e.button !== 0 ||
        e.metaKey ||
        e.ctrlKey ||
        e.shiftKey ||
        e.altKey
      ) {
        return;
      }
      const anchor = (e.target as Element | null)?.closest?.("a");
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;

      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#")) return;

      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
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

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);
}

export function RouteProgressBar() {
  useLinkNavigations();
  return <RouteProgress />;
}
