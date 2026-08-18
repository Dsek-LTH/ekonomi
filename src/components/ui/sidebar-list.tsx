"use client";

import { cn } from "@/lib/ui/utils";
import { Card } from "./card";

// The master column of a master–detail screen (the result unit list under
// Inställningar, the cost-centre list in a budget): a fixed-width
// panel of selectable rows, sections and inline footers.
export function SidebarPanel({
  children,
  className,
  ref,
  width = "lg:w-64",
}: {
  children: React.ReactNode;
  className?: string;
  /**
   * The panel element itself, for a screen that has to measure or move it —
   * the budget's list is sticky and walks its own offset as the page scrolls
   * (see lib/ui/use-sticky-follow.ts).
   */
  ref?: React.Ref<HTMLElement>;
  /**
   * Where the panel stops being a full-width list and becomes a fixed column —
   * which is to say the breakpoint its screen stands the detail beside it at.
   * A prop of its own rather than something to pass through `className`: `cn`
   * joins classes instead of merging them, so an override there would leave two
   * `lg:w-*` utilities in the attribute for Tailwind's emission order to settle.
   * Screens that stack for longer name their own — see the income queue, which
   * has the document panel to fit as well and waits until xl.
   */
  width?: string;
}) {
  return (
    // Until then the master–detail screens stack, so the panel is a full-width
    // list above the detail rather than a 16rem column beside it.
    <aside ref={ref} className={cn("w-full shrink-0", width, className)}>
      {/* A Card, not a lookalike: this panel stands beside the detail card on
          a master-detail screen, and it used to be the same shape with no
          elevation — which read as the list being a level behind. */}
      <Card className="overflow-hidden">{children}</Card>
    </aside>
  );
}

// One selectable row. Selection is the accent wash; everything else is left to
// `children`, which is usually a title line plus a muted detail line.
//
// The rest of the button's props pass through, the same way Card's do — a row
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
  return (
    <button
      {...rest}
      type="button"
      onClick={onClick}
      aria-current={active ? "true" : undefined}
      className={cn(
        "w-full px-4 py-2.5 text-left text-sm",
        active ? "bg-accent-soft text-accent" : "hover:bg-surface",
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
// in it — the income queue puts "new report for this day" beside the date, which
// is the only place where the day it would be for is already stated.
export function SidebarGroupLabel({
  children,
  action,
}: {
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <p className="flex items-center justify-between gap-2 bg-surface/60 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
      {/* Only clipped when it is sharing the row: a heading on its own wraps,
          which is what a long result-unit name in a 16rem column needs. */}
      <span className={cn(Boolean(action) && "min-w-0 truncate")}>{children}</span>
      {action}
    </p>
  );
}
