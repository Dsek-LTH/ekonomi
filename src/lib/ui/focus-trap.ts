"use client";

// Tab belongs to the topmost overlay, and to nothing else.
//
// `aria-modal` tells a screen reader that the rest of the page is inert. It
// does not make it so for the keyboard: without this, tabbing through a dialog
// walked out of its last control and on into the page behind, where every
// button was still focusable and still worked while a dialog claimed to be
// blocking them. Shift+Tab off the first control did the same thing upwards.
//
// The layers form a stack, the same arrangement Escape uses (lib/ui/escape.ts)
// and for the same reason: a scanner opened from inside the product form is one
// box inside another, and only the one on top should be holding the keyboard.
// One listener serves the stack, so which layer mounted first cannot decide it.

import { useEffect, useRef } from "react";

/** Everything a browser will Tab to, before the disabled and the hidden are
 *  weeded out below. */
const CANDIDATES =
  'a[href], area[href], button, input, select, textarea, video[controls], audio[controls], iframe, [contenteditable]:not([contenteditable="false"]), [tabindex]';

type Layer = () => HTMLElement | null;

const stack: Layer[] = [];
let listening = false;

/**
 * The stops inside a box, in the order Tab visits them.
 *
 * Document order, not `tabindex` order. Nothing in the app raises a positive
 * `tabindex`, and reading the DOM in order is what makes "the last one" mean
 * the control nearest the bottom of the dialog.
 */
function stops(box: HTMLElement): HTMLElement[] {
  return Array.from(box.querySelectorAll<HTMLElement>(CANDIDATES)).filter(
    (el) =>
      !el.hasAttribute("disabled") &&
      el.tabIndex >= 0 &&
      // A field that is only rendered for one kind of product, a button behind
      // `hidden`: laid out or not is the question, and an element with no boxes
      // at all is not somewhere focus can go.
      el.getClientRects().length > 0,
  );
}

function onKey(e: KeyboardEvent) {
  if (e.key !== "Tab") return;
  const box = stack[stack.length - 1]?.();
  if (!box) return;
  // A menu or a combobox opened from inside a dialog is portalled to <body>,
  // so by containment it is outside the box it belongs to. It is not: it is a
  // layer of its own, on top, and it does its own thing with Tab (the combobox
  // walks its options with it). Pulling focus back into the dialog underneath
  // would take the menu away mid-choice.
  if (document.activeElement?.closest("[data-popup-layer]")) return;
  const inside = stops(box);
  // Nothing to focus means nothing on the screen: the mobile menu is one of
  // these layers and is `display: none` from md up, where it can still be open
  // from before the window was widened. Swallowing Tab there would lock the
  // keyboard out of a page whose menu is not even drawn, so the key is let go
  // rather than held.
  if (inside.length === 0) return;
  const first = inside[0];
  const last = inside[inside.length - 1];
  const active = document.activeElement;
  // Focus outside the box entirely is the case where the dialog opened over
  // whatever button summoned it and nothing inside took focus. Tab moves in,
  // rather than carrying on through the page underneath.
  if (!box.contains(active)) {
    e.preventDefault();
    (e.shiftKey ? last : first).focus();
    return;
  }
  if (e.shiftKey && active === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  }
}

/**
 * Hold Tab inside `box` while this layer is the top one.
 *
 * `box` is read at the moment the key is pressed, so a dialog whose contents
 * change (a field that appears with the kind of product, a message that comes
 * and goes) needs to do nothing about it.
 */
export function useFocusTrap(active: boolean, box: React.RefObject<HTMLElement | null>): void {
  const latest = useRef(box);
  useEffect(() => {
    latest.current = box;
  });

  useEffect(() => {
    if (!active) return;
    const layer: Layer = () => latest.current.current;
    stack.push(layer);
    if (!listening) {
      // Capture, so the stack decides before anything in the tree reacts.
      document.addEventListener("keydown", onKey, true);
      listening = true;
    }
    return () => {
      const at = stack.indexOf(layer);
      if (at >= 0) stack.splice(at, 1);
    };
  }, [active]);
}
