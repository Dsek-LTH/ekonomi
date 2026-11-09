"use client";

import { useSyncExternalStore } from "react";

export type Platform = "installed" | "ios" | "android" | "other";

function readPlatform(): Platform {
  // `navigator.standalone` is Safari's own, older answer to the same question.
  const nav = navigator as Navigator & { standalone?: boolean };
  if (window.matchMedia("(display-mode: standalone)").matches || nav.standalone) {
    return "installed";
  }
  const ua = navigator.userAgent;
  // An iPad asks for the desktop site, so it says Macintosh. It has a touch
  // screen, which a Mac does not.
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) {
    return "ios";
  }
  if (/Android/.test(ua)) return "android";
  return "other";
}

export const installable = (p: Platform) => p === "ios" || p === "android";

// Read after hydration only: the server says "other", which draws nothing.
const never = () => () => {};

export function usePlatform(): Platform {
  return useSyncExternalStore(never, readPlatform, () => "other" as const);
}
