"use client";

// The counts beside the nav links, kept current on the client. The (app) layout reads them once, and a layout is not
// rendered again on navigation, so a change made on one page and followed by a push to another left them stale.
// Read again from /api/nav-counts after any change (markNavCountsStale, called by useMutation), on every page
// change, and when the tab comes back into view. A router.refresh() renders the layout again, which seeds them anew.

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

const STALE = "nav-counts:stale";

/** Say that something changed that the counts may depend on. Safe to call from anywhere on the client. */
export function markNavCountsStale(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(STALE));
}

const sameCounts = (a: Record<string, number>, b: Record<string, number>) => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) if ((a[k] ?? 0) !== (b[k] ?? 0)) return false;
  return true;
};

export function useLiveNavCounts(seed: Record<string, number>): Record<string, number> {
  const [counts, setCounts] = useState(seed);
  const pathname = usePathname();

  // A fresh render of the layout (router.refresh) is as current as a fetch.
  const [lastSeed, setLastSeed] = useState(seed);
  if (!sameCounts(seed, lastSeed)) {
    setLastSeed(seed);
    setCounts(seed);
  }

  // One read at a time, and only the latest one's answer is kept.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(0);
  const reload = useCallback(() => {
    // A change and the push after it come together: read once for both.
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const ticket = ++latest.current;
      try {
        const res = await fetch("/api/nav-counts", { cache: "no-store" });
        if (!res.ok) return;
        const next = (await res.json()) as Record<string, number>;
        if (ticket === latest.current) setCounts((prev) => (sameCounts(prev, next) ? prev : next));
      } catch {
        // Offline or signed out: the counts stay as they were.
      }
    }, 150);
  }, []);

  useEffect(() => {
    const onStale = () => reload();
    const pending = timer;
    const onVisible = () => {
      if (document.visibilityState === "visible") reload();
    };
    window.addEventListener(STALE, onStale);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener(STALE, onStale);
      document.removeEventListener("visibilitychange", onVisible);
      if (pending.current) clearTimeout(pending.current);
    };
  }, [reload]);

  // Every page change after the first: the page may have been reached by a push that skipped a refresh.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    reload();
  }, [pathname, reload]);

  return counts;
}
