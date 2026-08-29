"use client";

// "A pointer went down somewhere that isn't me" — the other half of dismissing
// a layer, beside Escape in lib/ui/escape.ts.
//
// This was written out four times: the menu, the combobox, the person search
// and the info hint each had their own copy of the same effect, and each
// carried its own copy of the same paragraph about why the event is
// `pointerdown`. One of the copies pointed at another copy to explain itself,
// which is the moment a thing has stopped being duplicated by accident.
//
// `pointerdown` rather than `mousedown`, and this is the whole reason the
// comment kept being copied: iOS only synthesises mouse events for targets it
// considers clickable — a link, a button, something carrying a click handler or
// `cursor: pointer`. A tap on the ordinary page behind an open menu fires no
// mouse event at all there, so the menu would not dismiss. `pointerdown` is
// native on iOS and fires for every target.
//
// Down rather than up, so a drag that starts outside closes immediately rather
// than waiting to see where the finger is lifted.

import { useEffect, useRef, type RefObject } from "react";

type Box = RefObject<HTMLElement | null>;

/**
 * Close a layer when a pointer goes down outside every one of `refs`.
 *
 * Several refs because a layer is not always one element: a combobox is a
 * trigger *and* a panel portalled somewhere else in the DOM, and a press on
 * either is a press on the layer. A ref that is currently null counts as not
 * containing anything, which is what makes a not-yet-rendered panel harmless.
 *
 * `close` may be a different function on every render — what the effect holds
 * is a ref to the latest one, so an inline arrow does not resubscribe the
 * listener on each keystroke. Same arrangement as `useEscape`, and for the same
 * reason.
 */
export function useDismissOnOutside(
  active: boolean,
  refs: Box | readonly Box[],
  close: () => void,
): void {
  // Both are kept in refs and synced after each render rather than depended on:
  // `close` is usually an inline arrow, and `refs` is often an array literal, so
  // either in a dependency array would tear the listener down and put it back on
  // every keystroke. Written in an effect, not during render — a ref is not a
  // render value, and the listener reads them at event time, long after.
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
