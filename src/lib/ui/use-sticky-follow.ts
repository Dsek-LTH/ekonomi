"use client";

// A sticky panel that follows the scroll in both directions.
//
// `position: sticky` alone only holds a panel that fits the screen. One that is
// longer — the budget's cost-centre list, which is every sheet in the budget —
// pins its top and leaves its own bottom permanently out of reach: the page
// scrolls, the panel does not, and the rows below the fold can never be read.
//
// So the pin moves with you. Scrolling down, the panel's `top` is walked
// upwards until its bottom edge is what is held; scrolling up, back down again
// until its top edge is. Between the two it simply travels with the page, which
// is what makes the whole of it reachable in either direction without ever
// scrolling it out of sight.
//
// The offset is written to the node rather than held in state: this runs on
// every scroll frame, and a re-render per frame is exactly what a sticky panel
// must not cost.
import { useEffect, useRef } from "react";

/** The box the element actually scrolls inside — the shell's, not the window's. */
function scrollPort(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(p).overflowY)) return p;
  }
  return null;
}

/**
 * @param gap Pixels held clear of the scrollport, above and below.
 * @returns A ref for the sticky element itself — the one carrying `sticky`.
 */
export function useStickyFollow<T extends HTMLElement>(gap = 32) {
  const ref = useRef<T>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const port = scrollPort(el);
    // A window without a scrolling ancestor is the page itself; the two answer
    // "how far down" and "how tall" differently and nothing else here differs.
    const target: HTMLElement | Window = port ?? window;
    const scrolled = () => (port ? port.scrollTop : window.scrollY);
    const viewport = () => (port ? port.clientHeight : window.innerHeight);

    let last = scrolled();
    let top = gap;
    el.style.top = `${top}px`;

    const follow = () => {
      const now = scrolled();
      const delta = now - last;
      last = now;
      // How far up the offset may go: enough that the panel's bottom edge sits
      // a gap above the fold. For a panel that already fits, that is more than
      // `gap` and the clamp below leaves it pinned at the top, as it should be.
      const floor = Math.min(gap, viewport() - el.offsetHeight - gap);
      top = delta > 0 ? Math.max(floor, top - delta) : Math.min(gap, top - delta);
      el.style.top = `${top}px`;
    };

    target.addEventListener("scroll", follow, { passive: true });
    // A shorter panel — the list filtered down by a search — may leave the
    // offset further up than it now has any use for; the next scroll settles
    // it, and this is what stops a resize alone from stranding it there.
    window.addEventListener("resize", follow);
    return () => {
      target.removeEventListener("scroll", follow);
      window.removeEventListener("resize", follow);
    };
  }, [gap]);

  return ref;
}
