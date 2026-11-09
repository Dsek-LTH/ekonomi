"use client";

// Marks <html> with `data-typing` while a field that raises a phone keyboard has focus, read by the `typing` variant
// in globals.css so the fixed receipt button can step aside. A bare `:has(input:focus)` selector never matched on iPhone.
import { useEffect } from "react";

/** What brings up a phone's keyboard. A checkbox or a radio does not. */
const KEYBOARD =
  'input:not([type="checkbox"], [type="radio"], [type="button"], [type="submit"], [type="file"], [type="range"]), textarea, select, [contenteditable="true"]';

/** Mounted once by the app shell. Re-reads on path change: a field that leaves the page with focus fires no event. */
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
    // Focus is nowhere for a moment between two fields; checking a frame later avoids flashing the tab bar.
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
