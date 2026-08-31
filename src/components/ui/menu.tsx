"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { IconChevronDown } from "@/components/ui/icons";
import { cn } from "@/lib/ui/utils";
import { useEscape } from "@/lib/ui/escape";
import { useDismissOnOutside } from "@/lib/ui/dismiss";

// A button that drops a short list of actions beneath itself. For the case where
// one button is really two or three variants of the same verb, "new budget",
// but empty or copied from one of these, and a form would only be asking a
// question the list can answer directly.
//
// Not a substitute for a form: everything here is one click with no arguments.
// If an action needs typing, it belongs on the page it leads to.
//
//   <Menu label="Ny budget" icon={<IconPlus className="size-4" />}>
//     <MenuItem onClick={createEmpty}>Tom budget 2026</MenuItem>
//   </Menu>

const CloseCtx = createContext<() => void>(() => {});

export function Menu({
  label,
  icon,
  variant = "primary",
  size = "md",
  disabled,
  loading = false,
  align = "end",
  compact = false,
  iconOnly = false,
  className,
  children,
}: {
  label: string;
  icon?: React.ReactNode;
  variant?: React.ComponentProps<typeof Button>["variant"];
  size?: React.ComponentProps<typeof Button>["size"];
  disabled?: boolean;
  /**
   * Below sm, show the icon alone.
   *
   * For a trigger that shares a row with the thing it is secondary to, the
   * expense page's actions, where the primary should have the width and this
   * should have as little of it as it can manage. The label stays as the
   * button's accessible name, so nothing is lost to a screen reader; it is the
   * pixels that go, not the word.
   */
  compact?: boolean;
  /**
   * The icon alone, at every width, with `label` left as the accessible name.
   *
   * For a menu that belongs to a row rather than to a page: a sheet with forty
   * products has forty of these, and a word beside each one is a column of
   * repeated text where the row's own content should be. `compact` is the
   * page-header version of the same idea. It keeps the word where there is
   * room for it, and the two are not the same question.
   */
  iconOnly?: boolean;
  /**
   * An action picked from this menu is still running. The trigger carries the
   * spinner because the item that started it is gone. The menu closes on
   * choosing, so the trigger is the only thing left to say so.
   */
  loading?: boolean;
  /** Which edge the panel lines up with, "end" hangs it left of the button. */
  align?: "start" | "end";
  className?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // Where the trigger is on screen. Held in state rather than read at paint,
  // because the panel is positioned against it from outside its subtree.
  const [rect, setRect] = useState<DOMRect | null>(null);

  const close = () => setOpen(false);

  function toggle() {
    setOpen((o) => {
      if (!o && triggerRef.current) setRect(triggerRef.current.getBoundingClientRect());
      return !o;
    });
  }

  // Clicking away closes it, and Escape closes it and hands focus back to the
  // button, otherwise a keyboard user is left standing on nothing.
  //
  // Both boxes, because the panel is portalled out of the trigger's subtree: a
  // press on a menu item is not a press "inside" the wrapper any more.
  useDismissOnOutside(open, [boxRef, panelRef], close);

  /**
   * The panel follows the trigger while the page moves under it, and closes if
   * the trigger goes away (a row deleted with its menu open). Same treatment
   * the combobox gives its own panel, and for the same reason: a fixed panel
   * whose trigger has moved is a panel in the wrong place.
   */
  useEffect(() => {
    if (!open) return;
    const follow = (e?: Event) => {
      // Not while scrolling the panel's own list, which moves nothing.
      if (e && panelRef.current?.contains(e.target as Node)) return;
      const el = triggerRef.current;
      if (!el || !el.isConnected) return close();
      setRect(el.getBoundingClientRect());
    };
    window.addEventListener("resize", follow);
    window.addEventListener("scroll", follow, true);
    window.visualViewport?.addEventListener("resize", follow);
    window.visualViewport?.addEventListener("scroll", follow);
    return () => {
      window.removeEventListener("resize", follow);
      window.removeEventListener("scroll", follow, true);
      window.visualViewport?.removeEventListener("resize", follow);
      window.visualViewport?.removeEventListener("scroll", follow);
    };
  }, [open]);

  const GAP = 4;
  const EDGE = 8;
  /** Below this much room underneath, look at whether there is more above. */
  const WANTED = 220;

  function panelStyle(): React.CSSProperties {
    if (!rect) return {};
    const under = window.innerHeight - rect.bottom - GAP - EDGE;
    const over = rect.top - GAP - EDGE;
    const dropUp = under < WANTED && over > under;
    // The horizontal edge is pinned rather than computed from a width, so the
    // panel keeps sizing itself to its own content (w-max, min-w-56) exactly as
    // it did while it was an absolutely positioned child.
    const side = align === "end"
      ? { right: Math.max(EDGE, window.innerWidth - rect.right) }
      : { left: Math.min(Math.max(EDGE, rect.left), window.innerWidth - EDGE) };
    return {
      position: "fixed",
      maxHeight: Math.max(140, dropUp ? over : under),
      ...side,
      ...(dropUp
        ? { bottom: window.innerHeight - rect.top + GAP }
        : { top: rect.bottom + GAP }),
    };
  }

  // Escape closes the menu and hands focus back to the button, and closes
  // only the menu, even inside a dialog that would once have gone with it.
  useEscape(open, () => {
    setOpen(false);
    triggerRef.current?.focus();
  });

  return (
    <div ref={boxRef} className={cn("relative", className)}>
      <Button
        ref={triggerRef}
        variant={variant}
        size={size}
        disabled={disabled}
        loading={loading}
        aria-haspopup="menu"
        aria-expanded={open}
        // Named even when the word is not drawn.
        aria-label={compact || iconOnly ? label : undefined}
        title={compact || iconOnly ? label : undefined}
        onClick={toggle}
        // The wrapper decides how wide this is, not the label. Everywhere a
        // menu currently stands it is a flex item that shrinks to its content,
        // so `w-full` is that same width, and where a caller does stretch it
        // (the table toolbar makes its action fill the row on a phone) the
        // trigger goes with it instead of sitting a third of the way across.
        className="w-full"
      >
        {icon}
        {!iconOnly && <span className={cn(compact && "hidden sm:inline")}>{label}</span>}
        {!iconOnly && (
          <IconChevronDown
            className={cn(
              "size-4 transition-transform duration-150",
              open && "rotate-180",
              // Nothing to point at once the label is gone. The icon is the
              // whole button, and a chevron beside it is half the width again
              // for no more meaning.
              compact && "hidden sm:block",
            )}
          />
        )}
      </Button>

      {/* Portalled to the body, with fixed positioning, so that no ancestor can
          crop it. As an absolutely positioned child it was cut off by any
          scroll container it happened to sit in: the stock sheet is a table
          inside TableScroll, whose `overflow-x-auto` also clips vertically (CSS
          forces the other axis to `auto` when one axis is not `visible`), so a
          row menu near the foot of the sheet lost its items to the edge of the
          card. No z-index could have fixed that. Clipping by an overflow
          ancestor is not a question of stacking order.

          z-[210] is the combobox's layer, and for the same reason: both are
          popovers over a field, both have to clear a modal at z-[200], and both
          belong under the notifications at z-[220]. */}
      {open && rect && createPortal(
        <div
          ref={panelRef}
          role="menu"
          aria-label={label}
          style={panelStyle()}
          className="z-[210] max-h-[min(70vh,26rem)] w-max min-w-56 max-w-[min(22rem,80vw)] overflow-y-auto rounded-xl border border-border bg-background p-1 shadow-[var(--shadow-pop)]"
        >
          <CloseCtx.Provider value={close}>{children}</CloseCtx.Provider>
        </div>,
        document.body,
      )}
    </div>
  );
}

// Choosing an item closes the menu. Every item here is a complete action, so
// there is never a reason to stay.
export function MenuItem({
  onClick,
  disabled,
  className,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const close = useContext(CloseCtx);
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={() => {
        close();
        onClick();
      }}
      className={cn(
        "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-surface disabled:pointer-events-none disabled:opacity-40",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function MenuSeparator() {
  return <div role="separator" className="my-1 h-px bg-border/60" />;
}

export function MenuLabel({ children }: { children: React.ReactNode }) {
  return <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wide text-muted">{children}</p>;
}

/** A closing line of small print: what the actions above will actually do. */
export function MenuNote({ children }: { children: React.ReactNode }) {
  return <p className="px-2.5 pb-1.5 pt-1 text-[11px] leading-snug text-muted">{children}</p>;
}
