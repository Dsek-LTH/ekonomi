"use client";

import { useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IconHelp } from "@/components/ui/icons";
import { placeAnchored, useAnchorRect } from "@/lib/ui/anchored-panel";
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
//
// The panel is portalled to <body> and placed with `position: fixed`, the way
// the menu and the combobox are (lib/ui/anchored-panel.ts). It used to hang off
// the button with `position: absolute`, which only works where nothing around
// the button makes a layer of its own. In Inställningar → Roller every row's
// name cell is sticky with a z-index, so a hint opened in one row was painted
// over by the rows below it, and the grid's horizontal scroll box cut off the
// part that reached past its edge.
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
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLSpanElement>(null);
  const [rect, setRect] = useAnchorRect(open, button, panel, () => setOpen(false));

  const show = () => {
    setRect(button.current?.getBoundingClientRect() ?? null);
    setOpen(true);
  };

  // Escape closes, and so does a press anywhere else. A panel opened by a tap
  // has no pointer leaving it to close it again.
  //
  // Escape goes through the shared stack rather than a listener of this hint's
  // own. The listener here was a plain one that never stopped the event, so a
  // hint opened inside a dialog handed the same keypress to the dialog behind
  // it and one press closed both. See lib/ui/escape.ts.
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
            // Starts at the button and runs right, held inside the window by
            // placeAnchored, which pulls it back from the right-hand edge for a
            // hint at the end of a card header. Below the button unless there
            // is more room above.
            style={placeAnchored(rect, {
              wanted: 160,
              width: Math.min(288, window.innerWidth - 16),
              minHeight: 80,
            })}
            // Over everything, dialogs included, like the other portalled
            // panels: they share <body> with the modals at z-[200].
            className="z-[210] overflow-y-auto rounded-panel border border-border bg-background p-3 text-left text-xs leading-relaxed font-normal text-muted shadow-[var(--shadow-pop)]"
          >
            {children}
          </span>,
          document.body,
        )}
    </span>
  );
}
