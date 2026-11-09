"use client";

// A tab row that scrolls sideways when wider than its box. Marks sides with more to show (`.scroll-strip` in
// globals.css fades them) and scrolls the active tab into view.
import { useLayoutEffect, useRef } from "react";

/**
 * `ref` is the scrolling box, which must be `relative` (tab offsetLeft is measured from it). Its children are the
 * tabs, unless `items` names the element that holds them.
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
      // A pixel of slack: fractional widths can report half a pixel short.
      const more = el.scrollWidth - el.clientWidth > 1;
      el.toggleAttribute("data-more-start", more && el.scrollLeft > 1);
      el.toggleAttribute(
        "data-more-end",
        more && el.scrollLeft < el.scrollWidth - el.clientWidth - 1,
      );
    };
    mark();
    el.addEventListener("scroll", mark, { passive: true });
    const ro = new ResizeObserver(mark);
    ro.observe(el);
    // The tabs can grow without the row resizing (badge count, font load).
    if (items?.current) ro.observe(items.current);
    return () => {
      el.removeEventListener("scroll", mark);
      ro.disconnect();
    };
  }, [ref, items]);

  // Scroll the row itself, not scrollIntoView, which would drag it under the sticky band. Jump on first draw, slide after.
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
