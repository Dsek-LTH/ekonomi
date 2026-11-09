"use client";

import { useId } from "react";

import { cn } from "@/lib/ui/utils";
import { CONTROL_SIZES } from "./field";
import { IconSearch } from "./icons";

export function SearchInput({
  className,
  inputClassName,
  id,
  ...props
}: {
  className?: string;
  inputClassName?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "className">) {
  // Every field gets an id: a browser will not autofill one with neither id nor name.
  const autoId = useId();
  return (
    <div className={cn("relative", className)}>
      <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-faint" />
      <input
        id={id ?? autoId}
        type="search"
        // `pl-8` for the glyph and `pr-2.5` land after the shared table's `px-2.5` in Tailwind's order, so they win.
        className={cn(
          CONTROL_SIZES.sm,
          "w-full border border-border-control bg-background pl-8 pr-2.5 text-sm text-foreground placeholder:text-muted",
          // A long hint ends in an ellipsis on a phone rather than being cut through a word.
          "max-md:text-ellipsis",
          inputClassName,
        )}
        {...props}
      />
    </div>
  );
}
