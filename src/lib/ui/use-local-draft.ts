"use client";

// A draft kept in localStorage. Read in an effect, not the initialiser, to avoid a hydration
// mismatch. Not a cache: callers clear it once sent.
import { useCallback, useEffect, useState } from "react";

export function useLocalDraft<T>(
  key: string,
  empty: T,
  /** Off, this is a plain `useState` (e.g. editing a record the server already holds). */
  enabled = true,
): [T, React.Dispatch<React.SetStateAction<T>>, () => void, () => void] {
  const [value, setValue] = useState<T>(empty);
  /**
   * The key whose draft has been read into `value` (null until then). Nothing is written
   * before that, or the first empty render overwrites the draft. State, not a ref, so the
   * wait is for a render, and a changed key cannot write old figures under the new key.
   */
  const [loadedKey, setLoadedKey] = useState<string | null>(null);

  // Reading localStorage on mount is the point of this effect; no render-time alternative avoids the server render.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!enabled) return;
    try {
      const raw = window.localStorage.getItem(key);
      // Merged over `empty` so a draft from an older screen version has no undefined fields.
      // A changed key must not leave the previous draft in state.
      setValue(raw ? { ...empty, ...(JSON.parse(raw) as T) } : empty);
    } catch {
      // Private mode, quota or an old draft: losing it is cheap, so no error.
    }
    setLoadedKey(key);
    // `empty` is a literal at every call site; listing it would reload the draft each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!enabled || loadedKey !== key) return;
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Written per keystroke, so no error notifications.
    }
  }, [key, value, enabled, loadedKey]);

  /** Drop the stored copy but leave the screen alone (avoids a flicker while navigating away). */
  const forget = useCallback(() => {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Private mode: nothing to remove.
    }
  }, [key]);

  const clear = useCallback(() => {
    setValue(empty);
    forget();
    // `empty` is a literal at every call site; as a dependency it would change `clear` every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forget]);

  return [value, setValue, clear, forget];
}
