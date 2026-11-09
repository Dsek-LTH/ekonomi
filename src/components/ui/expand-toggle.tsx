"use client";

import { Button } from "./button";
import { IconChevronDown } from "./icons";
import { cn } from "@/lib/ui/utils";

/** A quiet button that folds a list open under itself. The label is the caller's. */
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
