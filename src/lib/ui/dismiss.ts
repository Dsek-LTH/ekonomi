"use client";

// Close on a pointer press outside a layer, beside Escape (lib/ui/escape.ts). `pointerdown`, not `mousedown`:
// iOS fires no mouse events for taps on non-clickable targets. Down rather than up, so a drag from outside closes at once.

import { useEffect, useRef, type RefObject } from "react";

type Box = RefObject<HTMLElement | null>;

/**
 * Close a layer when a pointer goes down outside every one of `refs` (a null ref counts as not containing anything).
 * `close` may change every render without resubscribing, as in `useEscape`.
 */
export function useDismissOnOutside(
  active: boolean,
  refs: Box | readonly Box[],
  close: () => void,
): void {
  // Kept in refs synced after render: an inline `close` or array-literal `refs` would resubscribe per keystroke.
  const latest = useRef(close);
  const boxes = useRef<readonly Box[]>([]);
  useEffect(() => {
    latest.current = close;
    boxes.current = Array.isArray(refs) ? refs : [refs as Box];
  });

  useEffect(() => {
    if (!active) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (boxes.current.some((r) => r.current?.contains(target))) return;
      latest.current();
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [active]);
}
