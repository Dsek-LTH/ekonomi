"use client";

// A breakpoint the layout can branch on in JavaScript, for the handful of
// places CSS cannot reach.
//
// Almost everything responsive in this app is a Tailwind variant, and should
// stay that way: a `md:` class costs one render and works before hydration. But
// a `<table>` cannot be made narrow with classes alone. Its widths live in a
// `<colgroup>`, and hiding a `<td>` with `display:none` shifts every cell after
// it into the wrong column. The budget sheet is where that bites, so it asks
// here instead.
//
// `useSyncExternalStore`, not an effect: the server snapshot is what React
// renders and hydrates with, and the client snapshot is applied in the same
// commit afterwards. An effect that set state would do the same thing a paint
// later, and paint the wide layout onto a phone on the way past.
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
    // Wide on the server, because that is what the markup has always been and
    // because a phone correcting to narrow is a cheaper mistake than a desktop
    // correcting to wide.
    () => false,
  );
}

/** Below Tailwind's `md`, which is where this app's layouts change shape. */
export const usePhone = (): boolean => useMediaQuery("(max-width: 767px)");
