"use client";

// Unsaved work on a booking screen is kept as it is typed, so leaving can never lose it: a link, the browser's Back,
// a reload or a closed tab all come back to the same screen as it was left. That is why these screens never ask
// "Lämna utan att spara?". Kept in localStorage per user, and only for the version of the record it was typed on:
// once somebody saves the record an old draft would put stale numbers back, so it is dropped instead. A draft left a
// week is dropped too, and signing out drops them all (clearLocalDrafts), since a computer may be shared.
import { useCallback, useEffect, useRef, useState } from "react";
import { useRole } from "@/components/shell/role-context";

interface Stored<T> {
  version: string;
  savedAt: number;
  value: T;
}

const PREFIX = "draft:";
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

let swept = false;
/** Drops drafts older than MAX_AGE_MS. Once per page load. */
function sweep(store: Storage) {
  if (swept) return;
  swept = true;
  const now = Date.now();
  for (const key of Object.keys(store)) {
    if (!key.startsWith(PREFIX)) continue;
    try {
      const { savedAt } = JSON.parse(store.getItem(key) ?? "") as Stored<unknown>;
      if (!(now - savedAt < MAX_AGE_MS)) store.removeItem(key);
    } catch {
      store.removeItem(key);
    }
  }
}

/** Every draft on this computer, for signing out. */
export function clearLocalDrafts() {
  const store = storage();
  if (!store) return;
  for (const key of Object.keys(store)) if (key.startsWith(PREFIX)) store.removeItem(key);
}

/**
 * `name` names the form and its record (null keeps nothing), `version` is the record's updatedAt, `value` what the
 * form holds, `dirty` whether that differs from the record. A draft found on mount is handed to `restore` after the
 * first render, so the server's HTML and the first client render agree.
 */
export function useLocalDraft<T>({
  name,
  version,
  value,
  dirty,
  restore,
}: {
  name: string | null;
  version: string;
  value: T;
  dirty: boolean;
  restore: (value: T) => void;
}): { restored: boolean; clear: () => void; dismiss: () => void } {
  const { user } = useRole();
  const key = name ? `${PREFIX}${user.id}:${name}` : null;
  const [restored, setRestored] = useState(false);
  // Nothing is written until the stored draft has been looked at, or the first (clean) render would wipe it.
  const ready = useRef(false);
  // Saved: the record moves on, and the form is about to leave. Nothing more to keep.
  const done = useRef(false);
  const restoreRef = useRef(restore);
  useEffect(() => {
    restoreRef.current = restore;
  });

  useEffect(() => {
    const store = storage();
    if (!key || !store) return;
    sweep(store);
    let found: Stored<T> | null = null;
    try {
      found = JSON.parse(store.getItem(key) ?? "null") as Stored<T> | null;
    } catch {
      found = null;
    }
    if (!found || found.version !== version) {
      if (found) store.removeItem(key);
      ready.current = true;
      return;
    }
    const kept = found.value;
    // From a timer, so no state is written from the effect body itself (the same rule as use-query.ts).
    const timer = window.setTimeout(() => {
      restoreRef.current(kept);
      setRestored(true);
      ready.current = true;
    }, 0);
    return () => window.clearTimeout(timer);
  }, [key, version]);

  const serialized = JSON.stringify(value);
  useEffect(() => {
    const store = storage();
    if (!key || !store || !ready.current || done.current) return;
    if (!dirty) {
      store.removeItem(key);
      return;
    }
    try {
      const stored: Stored<unknown> = {
        version,
        savedAt: Date.now(),
        value: JSON.parse(serialized),
      };
      store.setItem(key, JSON.stringify(stored));
    } catch {
      // Full: the work stays on screen, it just is not kept past leaving.
    }
  }, [key, version, serialized, dirty]);

  const clear = useCallback(() => {
    done.current = true;
    setRestored(false);
    if (key) storage()?.removeItem(key);
  }, [key]);

  /** The restored-notice is answered. The draft itself follows the form: reset it, and dirty going false drops it. */
  const dismiss = useCallback(() => setRestored(false), []);

  return { restored, clear, dismiss };
}
