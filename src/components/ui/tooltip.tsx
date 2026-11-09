"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { placeAnchored, useAnchorRect } from "@/lib/ui/anchored-panel";
import { cn } from "@/lib/ui/utils";

// Opens at once on hover and focus (a `title` waits about a second). Portalled and fixed (lib/ui/anchored-panel.ts).
// aria-hidden: the trigger carries the same words itself.
export function Tooltip({
  label,
  align = "end",
  className,
  children,
}: {
  label: string | null;
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
            // Over dialogs. Not interactive, so it never sits between the reader and what they reached for.
            className="pointer-events-none z-[210] w-max max-w-72 rounded-control border border-border bg-background px-2.5 py-1.5 text-xs text-foreground shadow-[var(--shadow-pop)]"
          >
            {label}
          </span>,
          document.body,
        )}
    </span>
  );
}
