"use client";

import { IconX } from "@/components/ui/icons";
import { cn } from "@/lib/ui/utils";

export function TagChips({
  tags,
  onRemove,
  removeLabel,
  className,
}: {
  tags: string[];
  /** Makes each chip removable. Omitted, they are text. */
  onRemove?: (tag: string) => void;
  /** The accessible name of one chip's remove button, given the tag. Required with `onRemove`. */
  removeLabel?: (tag: string) => string;
  className?: string;
}) {
  if (tags.length === 0) return null;
  return (
    <ul className={cn("flex flex-wrap gap-1.5", className)}>
      {tags.map((tag) => (
        <li
          key={tag}
          className={cn(
            "flex items-center gap-1 rounded-control border border-border bg-surface px-2 text-xs text-muted",
            onRemove ? "h-6 pr-1" : "h-6",
          )}
        >
          <span className="max-w-40 truncate">{tag}</span>
          {onRemove && (
            <button
              type="button"
              onClick={() => onRemove(tag)}
              aria-label={removeLabel?.(tag)}
              title={removeLabel?.(tag)}
              className="rounded-control p-0.5 text-muted transition-colors hover:bg-background hover:text-foreground"
            >
              <IconX className="size-3" />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
