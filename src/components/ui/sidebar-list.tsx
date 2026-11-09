"use client";

import { createContext, useContext, useState } from "react";

import { cn } from "@/lib/ui/utils";
import { useMediaQuery } from "@/lib/ui/media";
import { Card } from "./card";
import { IconChevronDown, IconList } from "./icons";
import { Modal, ModalHeader } from "./modal";

/** The breakpoint where the panel becomes a column beside the detail. Literal classes: Tailwind reads source as text. */
const BANDS = {
  lg: { column: "lg:w-64", below: "(max-width: 1023px)" },
  xl: { column: "xl:w-56", below: "(max-width: 1279px)" },
} as const;

const PickedCtx = createContext<(() => void) | null>(null);

// The master column of a master-detail screen. Above the breakpoint it is a sticky column; below it, given a `bar`, it is a pinned bar that opens the same contents in a dialog. Without `bar` it stacks.
export function SidebarPanel({
  children,
  className,
  cardClassName,
  at = "lg",
  always = false,
  bar,
  barAside,
  sheetLabel,
}: {
  children: React.ReactNode;
  className?: string;
  cardClassName?: string;
  at?: keyof typeof BANDS;
  bar?: React.ReactNode;
  sheetLabel?: string;
  always?: boolean;
  barAside?: React.ReactNode;
}) {
  const band = BANDS[at];
  const collapsed = useMediaQuery(band.below) || always;
  const [open, setOpen] = useState(false);

  if (bar && collapsed) {
    return (
      <>
        {/* top-app-bar under the phone's app bar; from md the main column is the scrollport. z-10 stays under the app bar's 20.
        bg-canvas on the wrapper: the Card's rounded corners are transparent over a scrolling list. */}
        <div className="sticky top-app-bar z-10 bg-canvas">
          <Card className="flex items-stretch overflow-hidden">
            <button
              type="button"
              onClick={() => setOpen(true)}
              aria-haspopup="dialog"
              className="flex min-h-12 min-w-0 flex-1 items-center gap-2 px-4 py-2 text-left text-sm transition-colors hover:bg-hover active:bg-surface"
            >
              <IconList aria-hidden className="size-4 shrink-0 text-muted" />
              <span className="min-w-0 flex-1 truncate">{bar}</span>
              <IconChevronDown aria-hidden className="size-4 shrink-0 text-muted" />
            </button>
            {barAside && (
              <div className="flex shrink-0 items-center border-l border-border">{barAside}</div>
            )}
          </Card>
        </div>

        {open && (
          <Modal label={sheetLabel ?? ""} onClose={() => setOpen(false)} className="max-w-md">
            <ModalHeader title={sheetLabel ?? ""} />
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              <PickedCtx.Provider value={() => setOpen(false)}>{children}</PickedCtx.Provider>
            </div>
          </Modal>
        )}
      </>
    );
  }

  return (
    <aside className={cn("w-full shrink-0", band.column, className)}>
      <Card className={cn("overflow-hidden", cardClassName)}>{children}</Card>
    </aside>
  );
}

// One selectable row. The rest of the button's props pass through (a row can be a drop target).
export function SidebarItem({
  active,
  onClick,
  className,
  children,
  ...rest
}: React.ComponentProps<"button"> & { active: boolean }) {
  // Picking a row closes the collapsed panel's dialog. Search, comparison and a group's "+" must not.
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
        active
          ? "bg-accent-soft text-accent shadow-[inset_2px_0_0_var(--color-accent)]"
          : "hover:bg-hover",
        className,
      )}
    >
      {children}
    </button>
  );
}

// A section heading between groups. `action` belongs to the group, not to a row.
export function SidebarGroupLabel({
  children,
  action,
}: {
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <p className="flex items-center justify-between gap-2 bg-surface px-4 py-1.5 text-xs font-medium text-muted">
      {/* Only clipped when sharing the row: a heading on its own wraps. */}
      <span className={cn(Boolean(action) && "min-w-0 truncate")}>{children}</span>
      {action}
    </p>
  );
}
