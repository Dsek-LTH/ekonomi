import Link from "next/link";
import { IconChevronLeft } from "@/components/ui/icons";
import { cn } from "@/lib/ui/utils";

// Standard page wrapper: a consistent title/description/action header, one of
// three content widths, and uniform vertical rhythm between major blocks.
// Every page composes the same way: <PageShell title=… width=…>…</PageShell>.
//
//   form    – single-object forms / focused flows   (narrow)
//   content – settings, reading-oriented lists       (medium)
//   wide    – data tables, dashboards, detail grids  (full, inherits layout cap)
export type PageWidth = "form" | "content" | "wide";

// Exported so a route's loading skeleton renders at the same width as the page
// it stands in for — otherwise the content jumps sideways when the data lands.
export const PAGE_WIDTH: Record<PageWidth, string> = {
  form: "mx-auto max-w-2xl",
  content: "mx-auto max-w-6xl",
  wide: "",
};

// Where a nested page sits under its parent. A fixed route rather than browser
// history: it can name its destination, and it behaves the same however you got
// here — from the list, from a link someone sent you, or on a reload, where
// there is no history to go back through.
export interface BackTo {
  href: string;
  /** The destination, as it reads after the arrow: "← Expenses". */
  label: string;
}

export function PageShell({
  title,
  subtitle,
  description,
  action,
  back,
  width = "wide",
  children,
  className,
}: {
  /** Usually a string; a node when the page lets you edit the title in place
   *  (the budget page does). Typing it narrower than that is what sent that
   *  page around the shell to compose its own header. */
  title: React.ReactNode;
  /**
   * A second identifying line between the title and the description, in the
   * title's weight but smaller — for a page whose subject is named twice, like
   * a budget's year and which budget for that year it is. The description
   * below stays what it always is: the notes about that subject.
   */
  subtitle?: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  /**
   * The parent this page sits under, shown as a "← <label>" link above the
   * title. Only for nested pages — the ones reachable from the sidebar are
   * their own starting point, and the sidebar is the way back out of them.
   */
  back?: BackTo;
  width?: PageWidth;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn(PAGE_WIDTH[width], className)}>
      {/* Sectioned, not merely separated: blocks on a page stand 24px apart, so
          a 28px gap under the title made the header read as one more block in
          the stack. 40px is the step that says "this names everything below". */}
      <div className="mb-10">
        {/* Above the title rather than beside it, so it never competes with the
            action slot for room on a narrow screen. */}
        {back && (
          <Link
            href={back.href}
            className="-ml-1 mb-2 inline-flex items-center gap-1 rounded-lg px-1 py-0.5 text-sm text-muted transition-colors hover:text-foreground"
          >
            <IconChevronLeft className="size-4 shrink-0" />
            {back.label}
          </Link>
        )}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            {subtitle && (
              <p className="mt-1 text-lg font-medium tracking-tight">{subtitle}</p>
            )}
            {/* Further from the title than the subtitle is. The subtitle names
                the same subject a second time and belongs tight to it; the
                description is a different kind of thing and reads as one when
                it is given the room to. */}
            {description && (
              <p className="mt-2 max-w-prose text-[15px] text-muted">{description}</p>
            )}
          </div>
          {action}
        </div>
      </div>
      <div className="space-y-6">{children}</div>
    </div>
  );
}
