"use client";

// Whether somebody is typing: a field that brings up a phone's keyboard has
// the focus. Marked on <html> as `data-typing`, which the `typing` variant in
// globals.css reads, so the receipt button fixed to the foot of a form can
// step aside while the keyboard is up.
//
// It was the selector alone, `body:has(input:focus, …)`, with nothing in
// JavaScript at all. On iPhone it never matched. An attribute set from the focus events is the same rule said
// in a way every browser re-reads.
import { useEffect } from "react";

/** What brings up a phone's keyboard. A checkbox or a radio does not. */
const KEYBOARD =
  'input:not([type="checkbox"], [type="radio"], [type="button"], [type="submit"], [type="file"], [type="range"]), textarea, select, [contenteditable="true"]';

/**
 * Mounted once, by the app shell, with the current path.
 *
 * Read again whenever the path changes. A field that leaves the page while it
 * has the focus takes the focus with it and no event says so, so leaving the
 * new utlägg form from its title field left the page marked as typing, and the
 * receipt button stayed away on the next one.
 */
export function useTypingFlag(pathname: string): void {
  useEffect(() => {
    const el = document.activeElement;
    document.documentElement.toggleAttribute(
      "data-typing",
      el instanceof HTMLElement && el.matches(KEYBOARD),
    );
  }, [pathname]);

  useEffect(() => {
    const root = document.documentElement;
    const update = () => {
      const el = document.activeElement;
      root.toggleAttribute("data-typing", el instanceof HTMLElement && el.matches(KEYBOARD));
    };
    // On the way out the focus is nowhere for a moment, between the field
    // being left and the next one taken. Checking a frame later keeps the tab
    // bar from flashing up between two fields.
    const later = () => requestAnimationFrame(update);
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", later);
    return () => {
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", later);
      root.removeAttribute("data-typing");
    };
  }, []);
}
