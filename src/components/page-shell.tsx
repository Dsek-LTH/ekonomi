import { CollectionSwitch, type Collections } from "@/components/ui/collection-switch";
import { PageTabs, type PageTabsProps } from "@/components/ui/page-tabs";
import { ViewToggle } from "@/components/ui/view-toggle";
import { PageHeader } from "@/components/shell/section-nav";
import { cn } from "@/lib/ui/utils";

// Standard page wrapper. Widths: form (narrow), content (medium lists), wide (tables, dashboards).
export type PageWidth = "form" | "content" | "wide";

// Exported so loading skeletons match the page's width.
export const PAGE_WIDTH: Record<PageWidth, string> = {
  form: "mx-auto max-w-2xl",
  content: "mx-auto max-w-6xl",
  wide: "",
};

/** The view toggle's content. See `views` on PageShell. */
export interface Views {
  /** Names the toggle for a screen reader. */
  label: string;
  value: string;
  options: {
    value: string;
    label: string;
    icon: (p: { className?: string }) => React.ReactNode;
  }[];
  onChange: (value: string) => void;
  /** Keep the toggle's room but not the toggle, as `collectionsHidden`. */
  hidden?: boolean;
}

export function PageShell({
  title,
  subtitle,
  collections,
  pages,
  views,
  view,
  collectionsHidden = false,
  back,
  aside,
  width = "wide",
  children,
  className,
}: {
  /** A string, or a node when the page edits the title in place. */
  title: React.ReactNode;
  /** A second identifying line under the title. There is deliberately no description line. */
  subtitle?: React.ReactNode;
  /** Which collection this page lists ("Mina / Alla"). See components/ui/collection-switch.tsx. There is deliberately no `action` slot. */
  collections?: Collections;
  /** The parts of a nested record (a bokslut year), as underlined links under the title. See docs/navigation.md. */
  pages?: PageTabsProps;
  /** Tabell or Diagram, detail or frame, as icons on a strip above the content. See docs/navigation.md. */
  views?: Views;
  /** Which moment the page describes (the stock list's per datum). View state only, no actions. */
  view?: React.ReactNode;
  /** Keep the collection switch's room but not the switch, so the header height does not jump. */
  collectionsHidden?: boolean;
  /** The parent page: a back link above the title. Only for nested pages. */
  back?: string;
  /** Controls at the far end of the title line that apply to the whole page (budget comparison and lock). */
  aside?: React.ReactNode;
  width?: PageWidth;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    // `data-tour-page`: the page has rendered, not its skeleton (components/shell/guide.tsx).
    <div className={cn(PAGE_WIDTH[width], className)} data-tour-page>
      <PageHeader
        title={title}
        subtitle={subtitle}
        back={back}
        aside={aside}
        right={
          collections ? (
            <div
              className={cn("max-md:w-full", collectionsHidden && "invisible")}
              inert={collectionsHidden}
            >
              <CollectionSwitch {...collections} />
            </div>
          ) : (
            view
          )
        }
      />

      {(pages || views) && (
        <div
          className={cn(
            "mb-4 flex items-end justify-between gap-4",
            pages && "border-b border-border",
          )}
        >
          {pages ? <PageTabs {...pages} /> : <span />}
          {views && (
            <div className={cn("pb-1.5", views.hidden && "invisible")} inert={views.hidden}>
              <ViewToggle
                aria-label={views.label}
                value={views.value}
                options={views.options}
                onChange={views.onChange}
              />
            </div>
          )}
        </div>
      )}

      <div className="space-y-4">{children}</div>
    </div>
  );
}
