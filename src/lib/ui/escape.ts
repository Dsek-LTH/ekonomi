"use client";

// Escape belongs to the topmost layer only. Layers form a stack served by one listener, so registration order
// cannot close a dialog together with the menu inside it.

import { useEffect, useRef } from "react";

type Layer = () => void;

const stack: Layer[] = [];
let listening = false;

function onKey(e: KeyboardEvent) {
  if (e.key !== "Escape") return;
  const top = stack[stack.length - 1];
  if (!top) return;
  // Stop propagation so a React handler further down does not close a second layer.
  e.stopPropagation();
  e.preventDefault();
  top();
}

/** Closes this layer on Escape while it is the top one. `close` may change every render: a fixed shim calls the latest. */
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
