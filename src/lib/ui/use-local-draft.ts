"use client";

// A draft that survives the browser being closed.
//
// For a sheet that is filled in over minutes rather than seconds, in a cellar,
// on a phone that locks itself — the stock sheets. What is typed is kept in
// localStorage under a key of the caller's choosing and read back on the next
// visit, so the answer to "the screen went to sleep halfway through the pallet"
// is that nothing happened.
//
// Read in an effect rather than in `useState`'s initialiser: the initialiser
// runs during the server render too, where there is no localStorage, and a
// client that started from a stored draft while the server started from nothing
// is a hydration mismatch. So the first paint is the empty sheet and the draft
// arrives immediately after, which is a frame nobody sees and a whole class of
// bug avoided.
//
// Deliberately not a general cache: a draft is what has *not* been sent yet, and
// the moment it is, the caller clears it. Anything the server already knows
// belongs to the server.
import { useCallback, useEffect, useRef, useState } from "react";

export function useLocalDraft<T>(
  key: string,
  empty: T,
): [T, React.Dispatch<React.SetStateAction<T>>, () => void] {
  const [value, setValue] = useState<T>(empty);
  // Nothing is written back until the stored draft has had its chance to load —
  // otherwise the first render's empty value overwrites it before it arrives.
  const loaded = useRef(false);

  // Reading an external store on mount is what an effect is for, and the state
  // it sets is the whole point of the hook — there is no render-time way to do
  // this that does not read localStorage during the server render too. Disabled
  // for the same reason the stock sheet disables it for its focus effect.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    loaded.current = false;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw) setValue(JSON.parse(raw) as T);
    } catch {
      // A private-mode browser, a quota, or a draft written by an older version
      // of this screen. None of them is worth an error on the way into a sheet:
      // the cost is one lost draft and the sheet still works.
    }
    loaded.current = true;
  }, [key]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!loaded.current) return;
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Written on every keystroke, so a failure here would otherwise be a
      // notification per character.
    }
  }, [key, value]);

  const clear = useCallback(() => {
    setValue(empty);
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Nothing to do about it, and the draft is gone from state either way.
    }
    // `empty` is a literal at every call site; taking it as a dependency would
    // make `clear` a new function on every render and every effect that holds
    // it run again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return [value, setValue, clear];
}
