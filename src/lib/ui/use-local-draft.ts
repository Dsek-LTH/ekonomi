"use client";

// A draft that survives the browser being closed.
//
// For a sheet that is filled in over minutes rather than seconds, in a cellar,
// on a phone that locks itself: the stock sheets. What is typed is kept in
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
import { useCallback, useEffect, useState } from "react";

export function useLocalDraft<T>(
  key: string,
  empty: T,
  /**
   * Whether to keep a copy at all. Off, this is a plain `useState`.
   *
   * For a screen that is the same component in two errands: the utlägg wizard
   * drafts a new claim locally and edits an existing one straight, because
   * there the server already holds it and a local copy outliving somebody
   * else's change would put a stale figure back on the screen.
   */
  enabled = true,
): [T, React.Dispatch<React.SetStateAction<T>>, () => void, () => void] {
  const [value, setValue] = useState<T>(empty);
  /**
   * The key whose stored draft has been read into `value`. Null until one has.
   *
   * Nothing is written back before that, or the first render's empty value
   * overwrites the draft before it arrives. This used to be a ref, and a ref
   * cannot answer the question: both effects below run in the same commit, in
   * the order they are written, so a ref the loading effect sets is already set
   * by the time the writing effect runs, and the writing effect is still
   * holding the empty value from the render that has not happened yet. It wrote
   * `{}` over the draft every single time.
   *
   * In development that was the whole of it, because Strict Mode runs both
   * effects twice before letting a render through: the second read found the
   * `{}` the first write had just left, and an evening's typing was gone on
   * reload with the stored copy sitting there looking correct.
   *
   * State rather than a ref because the wait is for a *render*, which is the
   * thing a ref is unable to wait for. And it holds the key rather than a flag
   * so that a screen moving from one draft to another (the same sheet, a
   * different event) cannot write the old event's figures under the new one's
   * key in the commit before the new one has been read.
   */
  const [loadedKey, setLoadedKey] = useState<string | null>(null);

  // Reading an external store on mount is what an effect is for, and the state
  // it sets is the whole point of the hook. There is no render-time way to do
  // this that does not read localStorage during the server render too. Disabled
  // for the same reason the stock sheet disables it for its focus effect.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!enabled) return;
    try {
      const raw = window.localStorage.getItem(key);
      // Merged over `empty` rather than taken whole: a draft written by an
      // older version of the screen is missing whatever has been added since,
      // and a field arriving as `undefined` is how a form throws on render.
      // Nothing stored is an answer too, and it has to be said out loud: a key
      // that changes must not leave the previous key's draft sitting in state
      // to be written back under the new name.
      setValue(raw ? { ...empty, ...(JSON.parse(raw) as T) } : empty);
    } catch {
      // A private-mode browser, a quota, or a draft written by an older version
      // of this screen. None of them is worth an error on the way into a sheet:
      // the cost is one lost draft and the sheet still works.
    }
    setLoadedKey(key);
    // `empty` is a literal at every call site, so listing it here would reload
    // the stored draft on every render and undo what has just been typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!enabled || loadedKey !== key) return;
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Written on every keystroke, so a failure here would otherwise be a
      // notification per character.
    }
  }, [key, value, enabled, loadedKey]);

  /**
   * Drop the stored copy and leave what is on the screen alone.
   *
   * For a screen that has just sent what it was holding and is on its way
   * somewhere else: the draft is spent, but blanking the form somebody is still
   * looking at, in the frame before the page changes, is a flicker that reads
   * as work being lost.
   */
  const forget = useCallback(() => {
    // Only the stored copy. Nothing here stops the screen storing again if it
    // carries on being typed into, which is what a sheet that has just been
    // saved and is being filled in afresh wants.
    try {
      window.localStorage.removeItem(key);
    } catch {
      // A private-mode browser. There was nothing stored to remove.
    }
  }, [key]);

  const clear = useCallback(() => {
    setValue(empty);
    forget();
    // `empty` is a literal at every call site; taking it as a dependency would
    // make `clear` a new function on every render and every effect that holds
    // it run again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forget]);

  return [value, setValue, clear, forget];
}
