"use client";

// Positioning for `position: fixed` panels portalled out of the trigger's subtree (they do not move with the page).

import { useEffect, useState, type RefObject } from "react";

/**
 * The trigger's box, kept current while `open`, null while closed. The panel follows on scroll rather than closing
 * (on iOS, focusing a combobox raises the keyboard, which fires resize and scroll). `onGone` fires when the trigger
 * has left the document.
 */
export function useAnchorRect(
  open: boolean,
  trigger: RefObject<HTMLElement | null>,
  panel: RefObject<HTMLElement | null>,
  onGone: () => void,
): [DOMRect | null, (rect: DOMRect | null) => void] {
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    if (!open) return;
    const follow = (e?: Event) => {
      // Not while scrolling the panel's own list.
      // Only a node can be inside the panel: Safari throws when asked whether it contains the window.
      const target = e?.target;
      if (target instanceof Node && panel.current?.contains(target)) return;
      const el = trigger.current;
      if (!el || !el.isConnected) return onGone();
      setRect(el.getBoundingClientRect());
    };
    window.addEventListener("resize", follow);
    // Capturing, so a scroll in any ancestor is heard and not just the page's.
    window.addEventListener("scroll", follow, true);
    // The iOS keyboard resizes the visual viewport, not the layout one, and placement measures window.innerHeight.
    window.visualViewport?.addEventListener("resize", follow);
    window.visualViewport?.addEventListener("scroll", follow);
    return () => {
      window.removeEventListener("resize", follow);
      window.removeEventListener("scroll", follow, true);
      window.visualViewport?.removeEventListener("resize", follow);
      window.visualViewport?.removeEventListener("scroll", follow);
    };
    // `onGone` and the refs are stable enough in both callers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return [rect, setRect];
}

/** Held clear of the trigger, and of the window's own edges. */
const GAP = 4;
const EDGE = 8;

export interface Placement {
  /** How tall the panel would like to be: below this room it drops up rather than being squeezed. */
  wanted: number;
  /** Whether `wanted` also caps the height (combobox: yes, it counts rows; menu: no, `wanted` is only a threshold). */
  cap?: boolean;
  /** A fixed width, or none to size to content (the menu is `w-max`, so its horizontal edge is pinned). */
  width?: number;
  /** Which edge of the trigger the panel lines up with. */
  align?: "start" | "end";
  /** Never shorter than this, even where there is less room than that. */
  minHeight?: number;
}

/** Where to put the panel, as a style. Drops up only when there is more room above than below. */
export function placeAnchored(
  rect: DOMRect | null,
  { wanted, cap = false, width, align = "start", minHeight = 140 }: Placement,
): React.CSSProperties {
  if (!rect) return {};

  const under = window.innerHeight - rect.bottom - GAP - EDGE;
  const over = rect.top - GAP - EDGE;
  const dropUp = under < wanted && over > under;
  const room = dropUp ? over : under;

  const side =
    width !== undefined
      ? { left: Math.min(Math.max(EDGE, rect.left), window.innerWidth - width - EDGE), width }
      : align === "end"
        ? { right: Math.max(EDGE, window.innerWidth - rect.right) }
        : { left: Math.min(Math.max(EDGE, rect.left), window.innerWidth - EDGE) };

  return {
    position: "fixed",
    maxHeight: Math.max(minHeight, cap ? Math.min(wanted, room) : room),
    ...side,
    ...(dropUp ? { bottom: window.innerHeight - rect.top + GAP } : { top: rect.bottom + GAP }),
  };
}
