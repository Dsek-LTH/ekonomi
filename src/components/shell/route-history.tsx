"use client";

import { useCallback, useEffect } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
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

export function useGoBack(fallback: string): {
  href: string;
  onClick: (e: ReactMouseEvent<HTMLAnchorElement>) => void;
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
      e.preventDefault();
      goBack();
    },
    goBack,
  };
}

const RETURN_SCAN_LIMIT = 3;

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
