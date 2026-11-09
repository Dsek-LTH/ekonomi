import { cn } from "@/lib/ui/utils";

// For grids that cannot become a card list: scroll sideways inside their own card. `minWidth` is where the table stops shrinking and starts scrolling.
export function TableScroll({
  minWidth = "min-w-[44rem]",
  className,
  children,
}: {
  minWidth?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("overflow-x-auto overscroll-x-contain", className)}>
      <div className={minWidth}>{children}</div>
    </div>
  );
}
