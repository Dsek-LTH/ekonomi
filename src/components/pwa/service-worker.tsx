"use client";

import { useEffect, useSyncExternalStore } from "react";

// Service worker (public/sw.js) and Android's install prompt, set up from the root layout so they apply on /login too.

/** Chrome's install prompt. Not in the DOM typings: it is not a standard. */
type BeforeInstallPromptEvent = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

// Chrome fires `beforeinstallprompt` once, early. Kept until install-hint.tsx is on screen.
let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function ServiceWorker() {
  useEffect(() => {
    const onPrompt = (e: Event) => {
      // Holds back Chrome's own banner, so the hint is the one place it is offered.
      e.preventDefault();
      deferred = e as BeforeInstallPromptEvent;
      emit();
    };
    const onInstalled = () => {
      deferred = null;
      emit();
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);

    // Production only: in `next dev` a worker can keep an old page on screen.
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      // updateViaCache "none": the browser always asks for sw.js, so a new version (or the kill switch in sw.js) arrives on next load.
      navigator.serviceWorker
        .register("/sw.js", { scope: "/", updateViaCache: "none" })
        .catch(() => {});
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);
  return null;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useCanPromptInstall(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => deferred !== null,
    () => false,
  );
}

/** Opens Chrome's install dialog. A prompt can be used once, so it is spent either way. */
export async function promptInstall() {
  const e = deferred;
  if (!e) return;
  deferred = null;
  emit();
  await e.prompt();
  await e.userChoice;
}
