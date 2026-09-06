"use client";

import { createContext, useContext, useState } from "react";

import { cn } from "@/lib/ui/utils";
import { useMediaQuery } from "@/lib/ui/media";
import { Card } from "./card";
import { IconChevronDown, IconList } from "./icons";
import { Modal, ModalHeader } from "./modal";

/**
 * Where the panel stops being a full-width list and becomes a column beside the
 * detail, which is to say the breakpoint its screen stands the two side by
 * side at. Written out as literal classes rather than built from the key:
 * Tailwind reads these out of the source as text and never sees a template
 * string.
 */
const BANDS = {
  lg: { column: "lg:w-64", below: "(max-width: 1023px)" },
  xl: { column: "xl:w-64", below: "(max-width: 1279px)" },
} as const;

/** Told to close by a row that has just been picked. See `SidebarItem`. */
const PickedCtx = createContext<(() => void) | null>(null);

// The master column of a master–detail screen (the result unit list under
// Inställningar, the cost-centre list in a budget): a fixed-width
// panel of selectable rows, sections and inline footers.
//
// Above the breakpoint it is that column, sticky beside the detail, and the two
// are on screen together. Below it the screens used to stack (panel on top,
// detail under) and that is where it went wrong: the budget's panel is 786px
// of compare, search, list and add-row, so changing cost centre meant scrolling
// back up past all of it and then down again. The income queue had already
// noticed and capped its own list at `max-h-80`, which spends less of the screen
// on the same errand rather than fixing it.
//
// So below the breakpoint the panel is a bar and a dialog: the bar says what is
// selected and stays pinned while you work, and it opens the panel's own
// contents unchanged. Nothing is dropped or reshaped. The grouped list keeps
// its headings, its figures and its per-group actions, because it is the same
// tree either way.
//
// A screen that gives no `bar` keeps the old stacking, which is right for a
// panel short enough to sit above its detail.
export function SidebarPanel({
  children,
  className,
  ref,
  at = "lg",
  bar,
  sheetLabel,
}: {
  children: React.ReactNode;
  className?: string;
  /**
   * The panel element itself, for a screen that has to measure or move it,
   * the budget's list is sticky and walks its own offset as the page scrolls
   * (see lib/ui/use-sticky-follow.ts).
   */
  ref?: React.Ref<HTMLElement>;
  /** The breakpoint this screen stands its detail beside the panel at. */
  at?: keyof typeof BANDS;
  /**
   * What the collapsed bar says, normally the selected row's own line. Given
   * this, the panel collapses below the breakpoint; without it, it stacks.
   */
  bar?: React.ReactNode;
  /** What the dialog is announced and headed as. Required alongside `bar`. */
  sheetLabel?: string;
}) {
  const band = BANDS[at];
  const collapsed = useMediaQuery(band.below);
  const [open, setOpen] = useState(false);

  if (bar && collapsed) {
    return (
      <>
        {/* `top-14` under the phone's app bar; from md the frame is fixed and
            the main column is the scrollport, so the bar sticks to the top of
            that instead. z-10 to stay under the app bar's own 20.

            `bg-canvas` on the wrapper, not just the Card inside it. The Card is
            opaque but rounded, and a rounded box pinned over a scrolling list
            is transparent at its four corner arcs: the rows underneath slid
            through them, which reads as the bar being slightly see-through
            rather than as the geometry it is. Canvas is the page's own colour
            (body, globals.css), so the arcs go on showing exactly what they
            show when nothing is scrolling. */}
        <div className="sticky top-14 z-10 bg-canvas md:top-0">
          <Card className="overflow-hidden">
            <button
              type="button"
              onClick={() => setOpen(true)}
              aria-haspopup="dialog"
              className="flex min-h-12 w-full items-center gap-2 px-4 py-2 text-left text-sm transition-colors active:bg-surface"
            >
              <IconList aria-hidden className="size-4 shrink-0 text-muted" />
              <span className="min-w-0 flex-1 truncate">{bar}</span>
              <IconChevronDown aria-hidden className="size-4 shrink-0 text-muted" />
            </button>
          </Card>
        </div>

        {open && (
          <Modal
            label={sheetLabel ?? ""}
            onClose={() => setOpen(false)}
            className="max-w-md"
          >
            <ModalHeader title={sheetLabel ?? ""} />
            {/* The panel's own tree, unwrapped: it already brings its rules,
                its headings and its own inner scroller, and a ModalBody's
                padding around it would inset a list that is meant to reach the
                dialog's edges. */}
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              <PickedCtx.Provider value={() => setOpen(false)}>{children}</PickedCtx.Provider>
            </div>
          </Modal>
        )}
      </>
    );
  }

  return (
    // Until the breakpoint the master–detail screens stack, so the panel is a
    // full-width list above the detail rather than a 16rem column beside it.
    <aside ref={ref} className={cn("w-full shrink-0", band.column, className)}>
      {/* A Card, not a lookalike: this panel stands beside the detail card on
          a master-detail screen, and it used to be the same shape with no
          elevation, which read as the list being a level behind. */}
      <Card className="overflow-hidden">{children}</Card>
    </aside>
  );
}

// One selectable row. Selection is the accent wash; everything else is left to
// `children`, which is usually a title line plus a muted detail line.
//
// The rest of the button's props pass through, the same way Card's do. A row
// that is also a drop target (the income queue, which takes sold lines dragged
// onto another verksamhet's day) needs its own handlers, and wrapping it in a
// div to carry them would put the drop zone somewhere other than the thing that
// looks like the target.
export function SidebarItem({
  active,
  onClick,
  className,
  children,
  ...rest
}: React.ComponentProps<"button"> & { active: boolean }) {
  // Picking a row is the one thing that means "done with the list", so inside
  // the collapsed panel's dialog it closes it. Only this: the search box, the
  // comparison picker and a group's own "+" are all things you do *in* the
  // list, and a dialog that shut on the first keystroke would be unusable.
  const picked = useContext(PickedCtx);

  return (
    <button
      {...rest}
      type="button"
      onClick={(e) => {
        onClick?.(e);
        picked?.();
      }}
      aria-current={active ? "true" : undefined}
      className={cn(
        "w-full px-4 py-2.5 text-left text-sm",
        active ? "bg-accent-soft text-accent" : "hover:bg-hover",
        className,
      )}
    >
      {children}
    </button>
  );
}

// A section heading between groups of items.
//
// `action` is for a control that belongs to the group rather than to any one row
// in it. The income queue puts "new report for this day" beside the date, which
// is the only place where the day it would be for is already stated.
export function SidebarGroupLabel({
  children,
  action,
}: {
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <p className="flex items-center justify-between gap-2 bg-surface px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
      {/* Only clipped when it is sharing the row: a heading on its own wraps,
          which is what a long result-unit name in a 16rem column needs. */}
      <span className={cn(Boolean(action) && "min-w-0 truncate")}>{children}</span>
      {action}
    </p>
  );
}
