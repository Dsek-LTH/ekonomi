import { CollectionSwitch, type Collections } from "@/components/ui/collection-switch";
import type { PageTabsProps } from "@/components/ui/page-tabs";
import { BandPageTabs, PageHeader } from "@/components/shell/section-nav";
import { ReceiptRow } from "@/components/receipt/receipt-row";
import { cn } from "@/lib/ui/utils";

// Standard page wrapper. Widths: form (narrow), content (medium lists), wide (tables, dashboards).
export type PageWidth = "form" | "content" | "wide";

// Exported so loading skeletons match the page's width.
export const PAGE_WIDTH: Record<PageWidth, string> = {
  form: "mx-auto max-w-2xl",
  content: "mx-auto max-w-6xl",
  wide: "",
};

export function PageShell({
  title,
  eyebrow,
  subtitle,
  collections,
  pages,
  view,
  collectionsHidden = false,
  back,
  aside,
  menu,
  width = "wide",
  children,
  className,
}: {
  /** A string, or a node when the page edits the title in place. */
  title: React.ReactNode;
  /** A small line above the title: a record's reference and whose it is. */
  eyebrow?: React.ReactNode;
  /** A second identifying line under the title. There is deliberately no description line. */
  subtitle?: React.ReactNode;
  /** Which collection this page lists ("Mina / Alla"). See components/ui/collection-switch.tsx. There is deliberately no `action` slot. */
  collections?: Collections;
  /** The parts of a nested record (a bokslut year), as underlined links under the title. See docs/navigation.md. */
  pages?: PageTabsProps;
  /** Which moment the page describes (the stock list's per datum). View state only, no actions. */
  view?: React.ReactNode;
  /** Keep the collection switch's room but not the switch, so the header height does not jump. */
  collectionsHidden?: boolean;
  /** The parent page: a back arrow above the title that goes up to it (useGoUp). Only for nested pages. */
  back?: string;
  /** Controls at the far end of the title line that apply to the whole page (budget comparison and lock). */
  aside?: React.ReactNode;
  /** The record's own ⋯ menu (Radera and the like), right after the title. In the settings overlay it stands in the overlay's bar. */
  menu?: React.ReactNode;
  width?: PageWidth;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    // `data-tour-page`: the page has rendered, not its skeleton (components/shell/guide.tsx).
    <div className={cn(PAGE_WIDTH[width], className)} data-tour-page>
      <PageHeader
        title={title}
        eyebrow={eyebrow}
        subtitle={subtitle}
        back={back}
        aside={aside}
        menu={menu}
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

      {/* A view toggle is not placed here: it sits in the page's own toolbar (docs/navigation.md). */}
      {pages && <BandPageTabs back={back} pages={pages} />}

      {/* The page's receipt on a phone, under its title. Renders nothing without one, or from md. */}
      <ReceiptRow />

      <div className="space-y-4">{children}</div>
    </div>
  );
}
