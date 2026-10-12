"use client";

import { useRef } from "react";

/**
 * An `onFocus` handler that selects the field's contents the first time it is
 * focused, and never again.
 *
 * For a field that opens already focused *and* already holding a value: the
 * booking screen's verifikationsdatum, an utlägg's description when it is being
 * edited. Focusing alone is not enough there: the date's mask takes eight
 * digits and no more, so typing into a full one does nothing, and a cursor
 * sitting in a full field reads as an invitation that isn't one.
 *
 * Selecting on *every* focus is the opposite mistake. Clicking back into the
 * field to correct a single digit would wipe the lot, which is a worse surprise
 * than the one this fixes, so it happens once, on arrival, and the field
 * behaves like any other from then on.
 */
export function useSelectOnce() {
  const done = useRef(false);

  return (e: React.FocusEvent<HTMLInputElement>) => {
    if (done.current) return;
    done.current = true;
    e.currentTarget.select();
  };
}
