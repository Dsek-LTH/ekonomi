import { cn } from "@/lib/ui/utils";

// For the grids that cannot become a card list the way DataTable's do: a
// budget sheet, the utfall report, a comparison, because their columns are the
// point: you read across them. Those scroll sideways inside their own card
// rather than pushing the whole page along with them, which is what a wide
// table does on a phone when nothing contains it.
//
// `minWidth` is the width the table stops shrinking at and starts scrolling
// instead. Pick the narrowest width the columns are still readable at; the
// default suits a handful of amount columns.
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
