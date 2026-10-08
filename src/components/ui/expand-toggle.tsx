"use client";

import { Button } from "./button";
import { IconChevronDown } from "./icons";
import { cn } from "@/lib/ui/utils";

/**
 * "Visa konton ▾": a quiet button that folds a list open under itself.
 *
 * For a list that is there to be looked something up in rather than read, and
 * so is closed until asked for (the chart of accounts, a unit's cost centres,
 * a rate's history). The chevron turns over when it is open. It was written out
 * three times, a ghost button and a rotating chevron each, before it was this.
 *
 * The label is the caller's, and may change with `open` ("Visa" / "Dölj").
 */
export function ExpandToggle({
  open,
  onToggle,
  className,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Button variant="ghost" size="sm" aria-expanded={open} onClick={onToggle} className={className}>
      {children}
      <IconChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />
    </Button>
  );
}
