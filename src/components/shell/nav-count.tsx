import { cn } from "@/lib/ui/utils";

/**
 * How many things wait behind a link, beside its label: utlägg to attest, card
 * purchases to account for. Capped at 99, past which the exact figure is not
 * what anyone reads it for.
 */
export function NavCount({
  count,
  active,
  className,
}: {
  count: number;
  /** On the lit row, whose fill is the accent already. */
  active?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums",
        active ? "bg-background/25 text-on-brand" : "bg-accent text-on-brand",
        className,
      )}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
