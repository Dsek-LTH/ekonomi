"use client";

import { useEffect, useSyncExternalStore } from "react";

// What makes the site an app you can install: the service worker (public/sw.js)
// and Android's install prompt, both set up once, from the root layout, so
// they are in place on every page including /login.

/** Chrome's install prompt. Not in the DOM typings: it is not a standard. */
type BeforeInstallPromptEvent = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

// Chrome fires `beforeinstallprompt` once, early, on whatever page is open. It
// is caught here, on every page, and kept until the install hint
// (install-hint.tsx) is on screen to offer it, which is usually a different
// page from the one it fired on.
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

    // Production only. In `next dev` a worker between the page and the dev
    // server is one more thing that can keep an old page on screen, and the
    // web version is developed there.
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      // updateViaCache "none": the browser always asks for sw.js itself rather
      // than trusting its HTTP cache, so a new version (or the kill switch
      // described in sw.js) reaches every phone on its next page load.
      navigator.serviceWorker
        .register("/sw.js", { scope: "/", updateViaCache: "none" })
        .catch(() => {
          // An app without it still works. Nothing to tell the reader.
        });
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

/** Whether Chrome has offered to install the app and it can be prompted now. */
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
