"use client";

// The tags a product carries, drawn as chips.
//
// One component for the three places they appear (the list's row, the product's
// own page, and the form where they are set) so a tag looks the same wherever
// it is read, and so the removable version cannot drift into a second shape.
// Not components/ui/chip.tsx: that is a toggle, something you press to turn a
// role on. These say what a product is, and only in the form is one of them
// pressable at all.
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
  /** The accessible name of one chip's remove button, given the tag. Required
   *  with `onRemove`, since a row of buttons all called "Ta bort" says nothing
   *  about which one anybody is on. */
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
            // Room for the button when there is one, and a plain pill when
            // there is not. The height is the same either way, so a form and a
            // page do not draw two different chips.
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
