"use client";

// Tab belongs to the topmost overlay. `aria-modal` does not stop keyboard focus leaving a dialog, so layers form
// a stack (as in lib/ui/escape.ts) served by one listener.

import { useEffect, useRef } from "react";

/** Everything a browser will Tab to, before disabled and hidden are filtered out. */
const CANDIDATES =
  'a[href], area[href], button, input, select, textarea, video[controls], audio[controls], iframe, [contenteditable]:not([contenteditable="false"]), [tabindex]';

type Layer = () => HTMLElement | null;

const stack: Layer[] = [];
let listening = false;

/** The stops inside a box in Tab order (document order; nothing in the app uses positive `tabindex`). */
function stops(box: HTMLElement): HTMLElement[] {
  return Array.from(box.querySelectorAll<HTMLElement>(CANDIDATES)).filter(
    (el) =>
      !el.hasAttribute("disabled") &&
      el.tabIndex >= 0 &&
      // Skip elements with no layout boxes (`hidden`, conditionally rendered).
      el.getClientRects().length > 0,
  );
}

function onKey(e: KeyboardEvent) {
  if (e.key !== "Tab") return;
  const box = stack[stack.length - 1]?.();
  if (!box) return;
  // Menus and comboboxes are portalled to <body>, so they are outside the dialog by containment, but they are layers
  // of their own that handle Tab themselves.
  if (document.activeElement?.closest("[data-popup-layer]")) return;
  const inside = stops(box);
  // Nothing to focus: let Tab go (the mobile menu is display:none from md up but may still be open).
  if (inside.length === 0) return;
  const first = inside[0];
  const last = inside[inside.length - 1];
  const active = document.activeElement;
  // Focus outside the box (the dialog opened over its trigger): Tab moves in.
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

/** Holds Tab inside `box` while this layer is the top one. `box` is read at keypress time. */
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
