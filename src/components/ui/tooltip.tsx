"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { placeAnchored, useAnchorRect } from "@/lib/ui/anchored-panel";
import { cn } from "@/lib/ui/utils";

// A short hint on hover, shown at once.
//
// For when a `title` is too slow. The browser's own tooltip waits about a
// second before it appears, and for something the reader is meant to glance at
// in passing (who has this utlägg open, say) a second is long enough that they
// have already moved on. This opens the moment the pointer arrives, and on
// keyboard focus too, since hover is not something a keyboard has.
//
// Portalled and `position: fixed`, like InfoHint and the menus, so a table's
// horizontal scroll box cannot clip it and a sticky column cannot paint over it.
// See lib/ui/anchored-panel.ts.
//
// The text is not announced from here. A tooltip that only exists while hovered
// is no way to tell a screen reader anything, so the trigger carries the same
// words itself (an sr-only span, an aria-label), and this stays aria-hidden.
export function Tooltip({
  label,
  align = "end",
  className,
  children,
}: {
  /** What to show. Null renders the children alone, with no hover behaviour. */
  label: string | null;
  /** Which edge of the trigger the tooltip lines up with. */
  align?: "start" | "end";
  className?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const panel = useRef<HTMLSpanElement>(null);
  const [rect, setRect] = useAnchorRect(open, wrap, panel, () => setOpen(false));

  const show = () => {
    if (!label) return;
    setRect(wrap.current?.getBoundingClientRect() ?? null);
    setOpen(true);
  };
  const hide = () => setOpen(false);

  return (
    <span
      ref={wrap}
      className={cn("relative inline-flex", className)}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {open &&
        label &&
        rect &&
        createPortal(
          <span
            ref={panel}
            aria-hidden
            style={placeAnchored(rect, { wanted: 40, align, minHeight: 0 })}
            // Over everything, dialogs included, like the other portalled
            // panels. Not interactive: the pointer passes straight through, so
            // it can never sit between the reader and what they were reaching.
            className="pointer-events-none z-[210] w-max max-w-72 rounded-control border border-border bg-background px-2.5 py-1.5 text-xs text-foreground shadow-[var(--shadow-pop)]"
          >
            {label}
          </span>,
          document.body,
        )}
    </span>
  );
}
