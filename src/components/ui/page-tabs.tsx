"use client";

import Link from "next/link";
import { cn } from "@/lib/ui/utils";

// "Which part of this record?" Underlined links under a nested page's title,
// for a record with parts of its own: a bokslut year's checklist, vouchers
// and accounts. See docs/navigation.md.
//
// Links rather than a switch, because each part is a page of its own, and
// underlined because that is what tabs mean: sections of the thing directly
// below them. Not the band's section tabs, which are the pages of an area of
// the app, and not the collection switch, which only ever says whose.
export interface PageTabsProps {
  /** Names the row for a screen reader. */
  label: string;
  value: string;
  options: { value: string; label: string; href: string }[];
}

export function PageTabs({ label, value, options }: PageTabsProps) {
  return (
    <nav aria-label={label} className="flex min-w-0 gap-5 overflow-x-auto">
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
