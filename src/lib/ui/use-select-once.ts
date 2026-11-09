"use client";

import { useRef } from "react";

/**
 * An `onFocus` handler that selects the field's contents the first time it is focused only (for fields that open
 * focused and already filled, like a masked date). Selecting on every focus would wipe the value when fixing a digit.
 */
export function useSelectOnce() {
  const done = useRef(false);

  return (e: React.FocusEvent<HTMLInputElement>) => {
    if (done.current) return;
    done.current = true;
    e.currentTarget.select();
  };
}
