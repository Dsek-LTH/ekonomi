"use client";

import { cn } from "@/lib/ui/utils";
import { Card } from "./card";

// The master column of a master–detail screen (the result unit list under
// Inställningar, the cost-centre list in a budget): a fixed-width
// panel of selectable rows, sections and inline footers.
export function SidebarPanel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    // Below lg the master–detail screens stack, so the panel is a full-width
    // list above the detail rather than a 16rem column beside it.
    <aside className={cn("w-full shrink-0 lg:w-64", className)}>
      {/* A Card, not a lookalike: this panel stands beside the detail card on
          a master-detail screen, and it used to be the same shape with no
          elevation — which read as the list being a level behind. */}
      <Card className="overflow-hidden">{children}</Card>
    </aside>
  );
}

// One selectable row. Selection is the accent wash; everything else is left to
// `children`, which is usually a title line plus a muted detail line.
export function SidebarItem({
  active,
  onClick,
  className,
  children,
}: {
  active: boolean;
  onClick: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
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
export function SidebarGroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="bg-surface/60 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
      {children}
    </p>
  );
}
