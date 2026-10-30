"use client";

import { useCallback } from "react";

const FROM = { lg: "(min-width: 1024px)", xl: "(min-width: 1280px)" } as const;

/**
 * Sizes an element to the rest of the window below where it starts, from a
 * breakpoint (lg unless told otherwise).
 *
 * For a screen read by scrolling a long list against things that should stay
 * put: the ledger's accounts against its parameters, a budget's sheet against
 * its list of cost centres, a day of takings against the queue of days. When
 * the whole page scrolled, those went off the top with the column heads. Sized
 * to the window, the page itself has nothing to scroll, and only the columns
 * inside it move.
 *
 * Measured rather than written as a calc(): what sits above it (the page
 * header, a sync line that comes and goes) has no fixed height. 24px is kept
 * free at the bottom, the same margin the card keeps on its other sides.
 * Below the breakpoint the columns stack instead of standing side by side, so
 * the page has to scroll to reach them, and nothing is sized. `from` is the
 * breakpoint the screen stands them side by side at.
 *
 * The element has to be a direct child of PageShell's content. It may come and
 * go (the income queue's is only there in one of its two views): the ref is a
 * callback, so whichever element it is attached to is the one sized. Pair it
 * with `lg:-mb-14` (or `xl:`), which takes back the room the shell keeps under
 * every page and which a screen that fills the window has no use for.
 */
export function useFillViewport<T extends HTMLElement>(from: keyof typeof FROM = "lg") {
  // A callback ref that returns its own cleanup (React 19), so whatever element
  // it is attached to is set up, and torn down when it goes, with no state.
  return useCallback(
    (el: T | null) => {
      if (!el) return;
      const wide = window.matchMedia(FROM[from]);
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
      // The header above it can change height (the sync line, a wrapped
      // title), and that moves where this starts. The page shell's root is what
      // grows when it does. Setting this element's own height lands on the same
      // value next time round, so it settles rather than loops.
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
    },
    [from],
  );
}
