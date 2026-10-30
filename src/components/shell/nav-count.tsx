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
  alert,
  className,
}: {
  count: number;
  /** On the lit row, whose fill is a pink wash, so the count steps up to the
   *  card's white to stay a shape of its own. */
  active?: boolean;
  /** Pinned over the corner of an icon (the phone's tab bar). There it has no
   *  label beside it to lean on, so it is solid ink and a size smaller. These
   *  are props rather than classes from the caller because cn() only joins,
   *  and two heights in one class list are settled by emission order. */
  overlay?: boolean;
  /** In the primary button's pink, like the dot on the Meny button: a
   *  section's tabs, where the count is work waiting rather than a tally
   *  beside a link. Pink rather than red, which read as an error. */
  alert?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-mark px-1 font-medium tabular-nums",
        overlay
          ? "h-4 min-w-4 bg-foreground text-[10px] text-background"
          : cn(
              "h-[18px] min-w-[18px] text-[11px]",
              alert ? "action-fill text-white" : cn("text-muted", active ? "bg-background" : "bg-surface"),
            ),
        className,
      )}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
