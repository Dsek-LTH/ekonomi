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
          : "action-fill h-[18px] min-w-[18px] text-[11px] text-white",
        className,
      )}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
