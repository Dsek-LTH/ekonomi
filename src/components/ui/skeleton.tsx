import { useTranslations } from "next-intl";
import { cn } from "@/lib/ui/utils";
import { Card } from "./card";
import { PAGE_WIDTH, type PageWidth } from "../page-shell";

// Placeholders for a wait whose shape is already known. A skeleton is only
// worth more than a spinner if it is honest about what is coming — same
// widths, same paddings, same number of rows — otherwise the page reflows the
// moment the data lands and the placeholder was a lie. So these mirror the real
// components (Card, DataTable, PageShell) rather than approximating them, and
// the composites below are the only ones a route should need.
//
// Everything here is inert: `aria-hidden` on each block, with one `role=status`
// on the page wrapper, so a screen reader hears "loading" once instead of
// reading out fifty empty boxes.

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("skeleton rounded-md", className)} />;
}

// Paragraph-shaped filler. The last line is short, the way a real one is.
export function SkeletonText({
  lines = 3,
  className,
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div className={cn("space-y-2", className)}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton
          key={i}
          className={cn("h-4", i === lines - 1 ? "w-2/5" : "w-full")}
        />
      ))}
    </div>
  );
}

// The whole page, standing in for PageShell + PageHeader. Every loading.tsx
// starts here, so a route in flight keeps the width and the header rhythm of
// the route that is arriving.
export function SkeletonPage({
  width = "wide",
  back = false,
  description = true,
  action = false,
  titleWidth = "w-56",
  children,
}: {
  width?: PageWidth;
  /** Nested pages carry a "← parent" link above the title. */
  back?: boolean;
  description?: boolean;
  /** Pages whose header holds a primary button. */
  action?: boolean;
  titleWidth?: string;
  children?: React.ReactNode;
}) {
  const t = useTranslations("common");
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={t("loading")}
      className={PAGE_WIDTH[width]}
    >
      <div className="mb-10">
        {back && <Skeleton className="mb-2 h-4 w-28" />}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <Skeleton className={cn("h-8", titleWidth)} />
            {description && <Skeleton className="mt-2.5 h-4 w-72 max-w-full" />}
          </div>
          {action && <Skeleton className="h-10 w-36 rounded-full" />}
        </div>
      </div>
      <div className="space-y-6">{children}</div>
    </div>
  );
}

// Row widths cycle rather than randomise: a placeholder that reshuffles on
// every render draws the eye to itself, and on the server a random width would
// not survive hydration anyway.
const ROW_WIDTHS = ["w-2/5", "w-1/2", "w-1/3", "w-3/5", "w-5/12", "w-1/2"];

// The inside of a DataTable: filter bar, header, rows, pagination footer. Goes
// inside a <Card>, exactly as DataTable does — or use SkeletonTableCard, which
// wraps it for you.
//
// Below md the real table is drawn as stacked cards, so this is too: the same
// rows, laid out the way that width lays them out.
export function SkeletonTable({
  rows = 6,
  columns = 5,
  toolbar = true,
  tabs = false,
}: {
  rows?: number;
  columns?: number;
  /** The search / date-range bar above the rows. */
  toolbar?: boolean;
  /** A segmented control above the toolbar. */
  tabs?: boolean;
}) {
  const cols = Array.from({ length: columns }, (_, i) => i);
  return (
    <>
      {(toolbar || tabs) && (
        <div className="flex flex-col gap-3 border-b border-border px-inset py-3">
          {tabs && (
            <div className="flex flex-wrap gap-1">
              {["w-16", "w-24", "w-20"].map((w) => (
                <Skeleton key={w} className={cn("h-6 rounded-full", w)} />
              ))}
            </div>
          )}
          {toolbar && (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Skeleton className="h-9 rounded-lg sm:w-52 sm:shrink-0" />
              <Skeleton className="h-9 rounded-lg sm:min-w-48 sm:flex-1" />
            </div>
          )}
        </div>
      )}

      {/* Phone: one card per row, headline plus a trailing value. */}
      <div className="divide-y divide-border md:hidden">
        {Array.from({ length: rows }, (_, r) => (
          <div key={r} className="flex items-start justify-between gap-3 px-inset py-4">
            <Skeleton className={cn("h-4", ROW_WIDTHS[r % ROW_WIDTHS.length])} />
            <Skeleton className="h-4 w-16 shrink-0" />
          </div>
        ))}
      </div>

      <div className="hidden md:block">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border">
              {cols.map((c) => (
                <th key={c} className="px-3 py-3 first:pl-inset last:pr-inset">
                  <Skeleton className={cn("h-3", c === 0 ? "w-24" : "w-16")} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {Array.from({ length: rows }, (_, r) => (
              <tr key={r}>
                {cols.map((c) => (
                  <td key={c} className="px-3 py-4 first:pl-inset last:pr-inset">
                    <Skeleton
                      className={cn(
                        "h-4",
                        c === 0 ? ROW_WIDTHS[r % ROW_WIDTHS.length] : "w-16",
                      )}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between border-t border-border px-inset py-3">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-8 w-28" />
      </div>
    </>
  );
}

export function SkeletonTableCard(props: React.ComponentProps<typeof SkeletonTable>) {
  return (
    <Card>
      <SkeletonTable {...props} />
    </Card>
  );
}

// A Card with a header rule and some body content — the settings pages and the
// detail screens are stacks of these.
export function SkeletonCard({
  header = true,
  action = false,
  children,
  className,
}: {
  header?: boolean;
  /** Cards whose header carries a button on the right. */
  action?: boolean;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={className}>
      {header && (
        <div className="flex items-center justify-between gap-4 border-b border-border px-inset py-4">
          <div className="min-w-0">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="mt-1.5 h-3.5 w-56 max-w-full" />
          </div>
          {action && <Skeleton className="h-8 w-24 shrink-0 rounded-full" />}
        </div>
      )}
      <div className="px-inset py-5">{children ?? <SkeletonText lines={3} />}</div>
    </Card>
  );
}

// The bordered label/value list used by the profile and the wizard's review
// step — DetailList's rule spacing, with the value side short.
export function SkeletonDetailList({ rows = 4 }: { rows?: number }) {
  return (
    <div className="divide-y divide-border rounded-xl border border-border" aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center justify-between gap-4 px-4 py-2.5">
          <Skeleton className="h-4 w-28" />
          <Skeleton className={cn("h-4", ROW_WIDTHS[i % ROW_WIDTHS.length], "max-w-40")} />
        </div>
      ))}
    </div>
  );
}

// The master–detail frame: a fixed list column beside the thing it selects
// into. Mirrors SidebarPanel, including the way it stacks below lg.
export function SkeletonSidebarLayout({
  items = 6,
  children,
}: {
  items?: number;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      <aside className="w-full shrink-0 lg:w-64">
        <Card className="divide-y divide-border overflow-hidden">
          {Array.from({ length: items }, (_, i) => (
            <div key={i} className="px-3 py-2.5">
              <Skeleton className={cn("h-4", ROW_WIDTHS[i % ROW_WIDTHS.length])} />
            </div>
          ))}
        </Card>
      </aside>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

// A budget sheet: dense gridlines, a pinned header block, no filter bar. The
// spreadsheet screens read nothing like the rest of the app, so their
// placeholder shouldn't either.
export function SkeletonSheet({
  rows = 12,
  columns = 6,
}: {
  rows?: number;
  columns?: number;
}) {
  const cols = Array.from({ length: columns }, (_, i) => i);
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-4 border-b border-border px-inset py-4">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="ml-auto h-5 w-28" />
      </div>
      <div className="divide-y divide-border">
        {Array.from({ length: rows }, (_, r) => (
          <div key={r} className="flex items-center gap-3 px-inset py-2.5">
            <Skeleton className={cn("h-3.5 min-w-0 flex-1", ROW_WIDTHS[r % ROW_WIDTHS.length])} />
            {cols.map((c) => (
              <Skeleton
                key={c}
                className={cn("h-3.5 w-16 shrink-0", c > 1 && "hidden lg:block")}
              />
            ))}
          </div>
        ))}
      </div>
    </Card>
  );
}

// Stacked labelled fields, for the form screens.
export function SkeletonFields({ fields = 3 }: { fields?: number }) {
  return (
    <div className="space-y-4">
      {Array.from({ length: fields }, (_, i) => (
        <div key={i}>
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="mt-1.5 h-10 w-full rounded-xl" />
        </div>
      ))}
    </div>
  );
}
