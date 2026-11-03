"use client";

// A row of tabs that scrolls sideways once it is wider than its box, which on
// a phone is most of them: six utlägg stages do not fit 343px.
//
// Two things a bare `overflow-x-auto` does not do. It does not say there is
// more: the last tab is simply cut, and "Att bo" reads as a broken label. So
// each side with more to show is marked, and `.scroll-strip` in globals.css
// fades that side out. And it does not keep the current tab in view: open the
// list on its fifth stage and the line under it is off past the edge. So the
// row is scrolled to the active tab whenever that changes.
import { useLayoutEffect, useRef } from "react";

/**
 * `ref` is the box that scrolls. Its children are the tabs, unless `items`
 * names the element that holds them (the section tabs' list). Either way the
 * scrolling box must be `relative`, so a tab's offsetLeft is measured from it.
 */
export function useScrollStrip(
  ref: React.RefObject<HTMLElement | null>,
  active: number,
  items?: React.RefObject<HTMLElement | null>,
) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const mark = () => {
      // A pixel of slack, because widths are fractional and a row that fits
      // can still report itself half a pixel short of its content.
      const more = el.scrollWidth - el.clientWidth > 1;
      el.toggleAttribute("data-more-start", more && el.scrollLeft > 1);
      el.toggleAttribute("data-more-end", more && el.scrollLeft < el.scrollWidth - el.clientWidth - 1);
    };
    mark();
    el.addEventListener("scroll", mark, { passive: true });
    const ro = new ResizeObserver(mark);
    ro.observe(el);
    // The tabs grow without the row itself resizing: a badge count arriving,
    // a font landing.
    if (items?.current) ro.observe(items.current);
    return () => {
      el.removeEventListener("scroll", mark);
      ro.disconnect();
    };
  }, [ref, items]);

  // Moved on the row itself, not with scrollIntoView, which would also scroll
  // the page to bring the row into view and drag it under the sticky band.
  // Jumped there on the first draw, slid there after.
  const placed = useRef(false);
  useLayoutEffect(() => {
    const el = ref.current;
    const list = items?.current ?? el;
    const tab = active >= 0 ? (list?.children[active] as HTMLElement | undefined) : undefined;
    if (!el || !tab) return;
    const start = tab.offsetLeft;
    const end = start + tab.offsetWidth;
    // Room either side, so the tab is not left hard against the fade.
    const pad = 24;
    let left: number | null = null;
    if (start - pad < el.scrollLeft) left = start - pad;
    else if (end + pad > el.scrollLeft + el.clientWidth) left = end + pad - el.clientWidth;
    if (left !== null) {
      el.scrollTo({ left: Math.max(0, left), behavior: placed.current ? "smooth" : "auto" });
    }
    placed.current = true;
  }, [ref, items, active]);
}
