"use client";

// Escape belongs to the topmost thing on the screen, and to nothing else.
//
// Every layer used to listen on the document for itself, which meant they all
// heard the same keypress: opening a combobox inside a dialog and pressing
// Escape shut the menu *and* the dialog, and the scanner inside the product
// form took the form with it on the way out. Nobody meant to close two things.
//
// So the layers form a stack and one listener serves it. Whatever opened last
// is on top, and only it is asked. It is the same rule a person already has in
// their head — Escape undoes the most recent thing — and it cannot be got wrong
// by the order listeners happened to be registered in, which is what the old
// arrangement depended on and had backwards: a dialog mounts before the menu
// inside it, so the dialog always heard the key first.

import { useEffect, useRef } from "react";

type Layer = () => void;

const stack: Layer[] = [];
let listening = false;

function onKey(e: KeyboardEvent) {
  if (e.key !== "Escape") return;
  const top = stack[stack.length - 1];
  if (!top) return;
  // Nothing below gets a look in — including a React handler further down the
  // tree that would have closed a second layer on the same press.
  e.stopPropagation();
  e.preventDefault();
  top();
}

/**
 * Close this layer when Escape is pressed, but only while it is the top one.
 *
 * `close` may be a different function on every render without disturbing the
 * stack: what is pushed is a fixed shim that calls the latest one, so a layer
 * keeps its place in the order for as long as it is open.
 */
export function useEscape(active: boolean, close: Layer): void {
  const latest = useRef(close);
  useEffect(() => {
    latest.current = close;
  });

  useEffect(() => {
    if (!active) return;
    const layer: Layer = () => latest.current();
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
