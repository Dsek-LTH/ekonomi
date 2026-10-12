"use client";

import { useEffect, useRef } from "react";

/**
 * Sizes an element to the rest of the window below where it starts, from lg.
 *
 * For a screen read by scrolling a long list against things that should stay
 * put: the ledger's accounts against its parameters, a budget's sheet against
 * its list of cost centres. When the whole page scrolled, those went off the
 * top with the column heads. Sized to the window, the page itself has nothing
 * to scroll, and only the columns inside it move.
 *
 * Measured rather than written as a calc(): what sits above it (the page
 * header, a sync line that comes and goes) has no fixed height. 24px is kept
 * free at the bottom, the same margin the card keeps on its other sides.
 * Below lg the columns stack instead of standing side by side, so the page has
 * to scroll to reach them, and nothing is sized.
 *
 * The element has to be a direct child of PageShell's content and stay mounted
 * for as long as the page is: the size is set once on mount and kept up to date
 * from there, so swapping it for another element would leave the new one
 * unsized. Pair it with `lg:-mb-14`, which takes back the room the shell keeps
 * under every page and which a screen that fills the window has no use for.
 */
export function useFillViewport<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const wide = window.matchMedia("(min-width: 1024px)");
    const fit = () => {
      if (!wide.matches) {
        el.style.height = "";
        return;
      }
      const top = el.getBoundingClientRect().top;
      // Floored, so a fractional pixel cannot hand the page a scrollbar back.
      el.style.height = `${Math.max(320, Math.floor(window.innerHeight - top - 24))}px`;
    };
    fit();
    // The header above it can change height (the sync line, a wrapped title),
    // and that moves where this starts. The page shell's root is what grows
    // when it does. Setting this element's own height lands on the same value
    // next time round, so it settles rather than loops.
    const observer = new ResizeObserver(fit);
    const shell = el.parentElement?.parentElement;
    if (shell) observer.observe(shell);
    window.addEventListener("resize", fit);
    wide.addEventListener("change", fit);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", fit);
      wide.removeEventListener("change", fit);
    };
  }, []);
  return ref;
}
