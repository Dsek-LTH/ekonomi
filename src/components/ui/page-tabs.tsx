"use client";

import { useRef } from "react";
import Link from "next/link";
import { useScrollStrip } from "@/lib/ui/scroll-strip";
import { cn } from "@/lib/ui/utils";

// A page's own links: a record's parts, or two pages over the same data (docs/navigation.md).
// Two looks. Under a record's own title, an underlined bar of fixed height, each tab centred in it. On a page whose
// title is the section band's (BandPageTabs in components/shell/section-nav.tsx), small pills on the page below the
// band, so they do not read as a second copy of its tabs: no icons, no underline, the chosen one lifted like a
// view toggle's.
export interface PageTabsProps {
  label: string;
  value: string;
  options: {
    value: string;
    label: string;
    href: string;
    icon?: (p: { className?: string }) => React.ReactNode;
  }[];
}

export function PageTabs({
  label,
  value,
  options,
  variant = "underline",
}: PageTabsProps & { variant?: "underline" | "pills" }) {
  const pills = variant === "pills";
  const row = useRef<HTMLElement>(null);
  useScrollStrip(
    row,
    options.findIndex((o) => o.value === value),
  );
  return (
    // Scrolls on a phone with a fade and no scrollbar, like the filter tabs
    // (filter-tabs.tsx).
    <nav
      ref={row}
      aria-label={label}
      className={cn(
        "scroll-strip relative flex min-w-0 overflow-x-auto",
        // The pills' text starts where the band's tab labels do (px-3), less their own padding.
        pills ? "items-center gap-1 pl-0.5" : "h-10 items-stretch gap-1",
      )}
    >
      {options.map((o) => {
        const active = o.value === value;
        const Icon = o.icon;
        return (
          <Link
            key={o.value}
            href={o.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex shrink-0 items-center gap-2 whitespace-nowrap font-medium transition-colors",
              pills
                ? cn(
                    "h-7 rounded-control px-2.5 text-[13px]",
                    active
                      ? "bg-background text-foreground shadow-[var(--shadow-pill)]"
                      : "text-muted hover:bg-hover hover:text-foreground",
                  )
                : cn(
                    "-mb-px border-b-2 px-3 text-sm",
                    active
                      ? "border-foreground text-foreground"
                      : "border-transparent text-muted hover:border-border hover:text-foreground",
                  ),
            )}
          >
            {Icon && !pills && <Icon className="size-4 shrink-0" />}
            {o.label}
          </Link>
        );
      })}
    </nav>
  );
}
