"use client";

// A JS breakpoint for the few places CSS cannot reach (a `<table>` whose widths live in a `<colgroup>`).
// `useSyncExternalStore` so the client snapshot applies in the same commit as hydration, not a paint later.
import { useSyncExternalStore } from "react";

const subscribe = (query: string) => (onChange: () => void) => {
  const mql = window.matchMedia(query);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
};

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    subscribe(query),
    () => window.matchMedia(query).matches,
    // Wide on the server: a phone correcting to narrow is cheaper than a desktop correcting to wide.
    () => false,
  );
}

/** Below Tailwind's `md`, which is where this app's layouts change shape. */
export const usePhone = (): boolean => useMediaQuery("(max-width: 767px)");
