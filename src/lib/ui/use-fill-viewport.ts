"use client";

import { useCallback } from "react";

const FROM = { lg: "(min-width: 1024px)", xl: "(min-width: 1280px)" } as const;

/**
 * Sizes an element to the rest of the window below where it starts, from a breakpoint (lg unless told otherwise),
 * so only the columns inside scroll. Measured, not a calc(): what sits above has no fixed height. 24px stays free at
 * the bottom. Below `from` the columns stack and nothing is sized.
 *
 * The element must be a direct child of PageShell's content. The ref is a callback so a coming-and-going element is
 * sized. Pair with `lg:-mb-14` (or `xl:`) to take back the room the shell keeps under every page.
 */
export function useFillViewport<T extends HTMLElement>(from: keyof typeof FROM = "lg") {
  // A callback ref returning its own cleanup (React 19), so no state is needed.
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
      // The header above can change height, which moves where this starts; setting our height settles rather than loops.
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
