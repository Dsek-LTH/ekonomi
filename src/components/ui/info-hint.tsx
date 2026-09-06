"use client";

import { useId, useRef, useState } from "react";
import { IconHelp } from "@/components/ui/icons";
import { useDismissOnOutside } from "@/lib/ui/dismiss";
import { useEscape } from "@/lib/ui/escape";
import { cn } from "@/lib/ui/utils";

// A "?" beside a control, with the explanation the control itself has no room
// for. Hover to read it.
//
// Not a `title` attribute, which is what the rest of the app uses for a word or
// two: the browser's own tooltip takes a second to appear, can't be styled, and
// collapses whitespace, so anything with structure (a list of what a file has
// to contain, say) arrives as one long line after a pause. That is fine for
// "Ta bort" and no use at all for an explanation someone is actually reading.
//
// Hover is not the only way in. It doesn't exist on a phone, and it isn't
// available to anyone on a keyboard, so focus opens it too and a click toggles
// it: three ways to the same panel rather than one that half the readers of
// this page don't have.
export function InfoHint({
  label,
  children,
  className,
}: {
  /** Names the button for screen readers and for the native tooltip. */
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const wrap = useRef<HTMLSpanElement>(null);

  // Escape closes, and so does a press anywhere else. A panel opened by a tap
  // has no pointer leaving it to close it again.
  //
  // Escape goes through the shared stack rather than a listener of this hint's
  // own. The listener here was a plain one that never stopped the event, so a
  // hint opened inside a dialog handed the same keypress to the dialog behind
  // it and one press closed both. See lib/ui/escape.ts.
  useEscape(open, () => setOpen(false));
  useDismissOnOutside(open, wrap, () => setOpen(false));

  return (
    <span
      ref={wrap}
      className={cn("relative inline-flex", className)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label={label}
        title={label}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((v) => !v)}
        className="flex size-7 items-center justify-center rounded-full text-muted transition-colors hover:bg-hover hover:text-foreground focus-visible:bg-hover focus-visible:text-foreground"
      >
        <IconHelp className="size-4" />
      </button>
      {open && (
        <span
          id={id}
          role="tooltip"
          // Right-aligned: this sits at the right-hand end of a card header, so
          // a panel growing rightwards would leave the card. Below rather than
          // above for the same reason: the header is at the top of the page.
          className="absolute right-0 top-full z-50 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-background p-3 text-left text-xs leading-relaxed font-normal text-muted shadow-[var(--shadow-pop)]"
        >
          {children}
        </span>
      )}
    </span>
  );
}
