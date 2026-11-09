"use client";

import { useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IconHelp } from "@/components/ui/icons";
import { placeAnchored, useAnchorRect } from "@/lib/ui/anchored-panel";
import { useDismissOnOutside } from "@/lib/ui/dismiss";
import { useEscape } from "@/lib/ui/escape";
import { cn } from "@/lib/ui/utils";

// A "?" with an explanation too long for a title attribute. Hover, focus and click all open it.
// Portalled to <body> with position: fixed (lib/ui/anchored-panel.ts): absolute got painted over by sticky rows and cut by scroll boxes.
export function InfoHint({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const wrap = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLSpanElement>(null);
  const [rect, setRect] = useAnchorRect(open, button, panel, () => setOpen(false));

  const show = () => {
    setRect(button.current?.getBoundingClientRect() ?? null);
    setOpen(true);
  };

  // Escape goes through the shared stack (lib/ui/escape.ts) so a hint inside a dialog does not close both. A press elsewhere also closes.
  useEscape(open, () => setOpen(false));
  useDismissOnOutside(open, [wrap, panel], () => setOpen(false));

  return (
    <span
      ref={wrap}
      className={cn("relative inline-flex", className)}
      onMouseEnter={show}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        ref={button}
        type="button"
        aria-label={label}
        title={label}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onFocus={show}
        onBlur={() => setOpen(false)}
        onClick={() => (open ? setOpen(false) : show())}
        className="flex size-7 items-center justify-center rounded-control text-muted transition-colors hover:bg-hover hover:text-foreground focus-visible:bg-hover focus-visible:text-foreground"
      >
        <IconHelp className="size-4" />
      </button>
      {open &&
        rect &&
        createPortal(
          <span
            ref={panel}
            id={id}
            role="tooltip"
            style={placeAnchored(rect, {
              wanted: 160,
              width: Math.min(288, window.innerWidth - 16),
              minHeight: 80,
            })}
            // Over dialogs: shares <body> with the modals at z-[200].
            className="z-[210] overflow-y-auto rounded-panel border border-border bg-background p-3 text-left text-xs leading-relaxed font-normal text-muted shadow-[var(--shadow-pop)]"
          >
            {children}
          </span>,
          document.body,
        )}
    </span>
  );
}
