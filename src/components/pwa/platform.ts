"use client";

import { useSyncExternalStore } from "react";

// Which way this device puts a site on its home screen, if it does at all.
// Shared by the dashboard's card (install-hint.tsx) and the first step of the
// app tour on a phone (shell/guide.tsx), which both offer the same thing.

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

/** Not installed yet, on a device that has a home screen to put it on. */
export const installable = (p: Platform) => p === "ios" || p === "android";

// The answer does not change while the page is open, so there is nothing to
// subscribe to. The store is for reading it after hydration only: the server
// says "other", which draws nothing, and the client does not disagree.
const never = () => () => {};

export function usePlatform(): Platform {
  return useSyncExternalStore(never, readPlatform, () => "other" as const);
}
