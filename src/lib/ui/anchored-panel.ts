"use client";

// A panel that hangs off a trigger: where it goes, and keeping it there.
//
// The third of the three things every layer in this app needs, beside Escape
// (lib/ui/escape.ts) and the outside press (lib/ui/dismiss.ts), and the last
// one still written out per component. The menu and the combobox each carried
// an identical effect: the same `follow`, the same eight add/remove listener
// calls, the same guard against the panel's own scroll. Neither could be fixed
// without remembering the other existed.
//
// Both panels are `position: fixed` and portalled out of the trigger's subtree,
// which is what makes this necessary at all. A fixed panel does not move with
// the page, so it has to be told where its trigger went.

import { useEffect, useState, type RefObject } from "react";

/**
 * The trigger's box, kept current while `open`, and null while closed.
 *
 * The panel *follows* rather than closing on scroll, and that is the whole
 * reason this exists. Closing was the obvious rule and it was wrong on iOS:
 * opening a combobox focuses its search box, focusing it raises the keyboard,
 * and the keyboard fires both a resize and a scroll, so the menu shut itself
 * the instant it opened, every time. Following is also simply better: the panel
 * stays where it belongs instead of vanishing because something nudged the page.
 *
 * `onGone` fires when the trigger has left the document, a row deleted with its
 * menu open. There is nothing left to point at, so the layer closes.
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
      // Not while scrolling the panel's own list, which moves nothing.
      //
      // Only a node can be inside the panel. A resize comes from the window and
      // the keyboard's from the visual viewport, and Safari throws on being
      // asked whether the panel contains either, where other browsers say no.
      const target = e?.target;
      if (target instanceof Node && panel.current?.contains(target)) return;
      const el = trigger.current;
      if (!el || !el.isConnected) return onGone();
      setRect(el.getBoundingClientRect());
    };
    window.addEventListener("resize", follow);
    // Capturing, so a scroll in any ancestor is heard and not just the page's.
    window.addEventListener("scroll", follow, true);
    // The keyboard on iOS changes the visual viewport without necessarily
    // moving the layout one, and the placement below measures itself against
    // `window.innerHeight`, so the panel has to be told, or it keeps sizing
    // itself to a screen half of which is now keyboard.
    window.visualViewport?.addEventListener("resize", follow);
    window.visualViewport?.addEventListener("scroll", follow);
    return () => {
      window.removeEventListener("resize", follow);
      window.removeEventListener("scroll", follow, true);
      window.visualViewport?.removeEventListener("resize", follow);
      window.visualViewport?.removeEventListener("scroll", follow);
    };
    // `onGone` and the refs are stable enough in both callers; re-subscribing on
    // every render of an open menu is what this is avoiding.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return [rect, setRect];
}

/** Held clear of the trigger, and of the window's own edges. */
const GAP = 4;
const EDGE = 8;

export interface Placement {
  /**
   * How tall the panel would like to be: the height below which it would rather
   * drop up than be squeezed.
   */
  wanted: number;
  /**
   * Whether `wanted` also caps the height, or only decides which way to open.
   *
   * The two callers differ here and the difference is real. The combobox knows
   * how tall its list wants to be (it counts the rows) so growing past that
   * would leave blank panel below the last option. A menu does not: `wanted` is
   * a threshold it was given, and capping at it would cut a long menu short
   * where the screen had room for all of it.
   */
  cap?: boolean;
  /**
   * A fixed width, or none to let the panel size itself to its content.
   *
   * The combobox wants one (its menu is as wide as the field, at least 240) and
   * the menu does not (`w-max`, `min-w-56`), which is why the horizontal edge
   * below is pinned rather than computed from a width it may not have.
   */
  width?: number;
  /** Which edge of the trigger the panel lines up with. */
  align?: "start" | "end";
  /** Never shorter than this, even where there is less room than that. */
  minHeight?: number;
}

/**
 * Where to put the panel, as a style.
 *
 * Drops up only when there is genuinely more room above than below: a panel
 * that flipped whenever it did not fit would flip on a page scrolled halfway,
 * which reads as the menu jumping about under the pointer.
 */
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
