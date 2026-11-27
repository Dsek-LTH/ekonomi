import { cn } from "@/lib/ui/utils";

export function NavCount({
  count,
  overlay,
  className,
}: {
  count: number;
  overlay?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-mark px-1 font-medium tabular-nums",
        overlay
          ? "h-4 min-w-4 bg-foreground text-[10px] text-background"
          : // The pink hue with ink: work waiting on the reader, said quietly beside the label. Full pink is for buttons.
            "h-[18px] min-w-[18px] bg-action-from/30 text-[11px] text-foreground",
        className,
      )}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
