"use client";

import { useRef } from "react";
import Link from "next/link";
import { useScrollStrip } from "@/lib/ui/scroll-strip";
import { cn } from "@/lib/ui/utils";

// Underlined links for a record's own parts (docs/navigation.md).
export interface PageTabsProps {
  label: string;
  value: string;
  options: { value: string; label: string; href: string }[];
}

export function PageTabs({ label, value, options }: PageTabsProps) {
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
      className="scroll-strip relative flex min-w-0 gap-5 overflow-x-auto max-md:gap-4"
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Link
            key={o.value}
            href={o.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px whitespace-nowrap border-b-2 py-2 text-sm transition-colors",
              active
                ? "border-foreground font-medium text-foreground"
                : "border-transparent text-muted hover:text-foreground",
            )}
          >
            {o.label}
          </Link>
        );
      })}
    </nav>
  );
}
