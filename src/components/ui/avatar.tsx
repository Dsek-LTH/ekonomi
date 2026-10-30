import { cn } from "@/lib/ui/utils";

export function Avatar({
  initials,
  className,
}: {
  initials: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-surface text-[11px] font-semibold text-muted",
        className,
      )}
    >
      {initials}
    </span>
  );
}
