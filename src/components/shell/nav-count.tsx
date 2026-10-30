import { cn } from "@/lib/ui/utils";

/**
 * How many things wait behind a link, beside its label: utlägg to attest, card
 * purchases to account for. Capped at 99, past which the exact figure is not
 * what anyone reads it for.
 */
export function NavCount({
  count,
  active,
  overlay,
  className,
}: {
  count: number;
  /** On the lit row, whose fill is the hover grey, so the count steps up to
   *  the card's white to stay a shape of its own. */
  active?: boolean;
  /** Pinned over the corner of an icon (the phone's tab bar). There it has no
   *  label beside it to lean on, so it is solid ink and a size smaller. These
   *  are props rather than classes from the caller because cn() only joins,
   *  and two heights in one class list are settled by emission order. */
  overlay?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-mark px-1 font-medium tabular-nums",
        overlay
          ? "h-4 min-w-4 bg-foreground text-[10px] text-background"
          : cn("h-[18px] min-w-[18px] text-[11px] text-muted", active ? "bg-background" : "bg-surface"),
        className,
      )}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
