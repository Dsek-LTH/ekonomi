import { CollectionSwitch, type Collections } from "@/components/ui/collection-switch";
import { PageTabs, type PageTabsProps } from "@/components/ui/page-tabs";
import { ViewToggle } from "@/components/ui/view-toggle";
import { PageHeader } from "@/components/shell/section-nav";
import { cn } from "@/lib/ui/utils";

// Standard page wrapper: a header that says what you are looking at, one of
// three content widths, and uniform vertical rhythm between major blocks.
// Every page composes the same way: <PageShell title=… width=…>…</PageShell>.
//
// The header is identity and nothing else: the title, and which
// collection of things this is (`collections`, beside the title). What you can
// *do* is not here: it belongs to the thing you would do it to, so a list's
// create button rides its own toolbar (DataTable's `action`) and an object's
// actions ride the header of the card that describes it.
//
//   form    - single-object forms / focused flows   (narrow)
//   content - settings, reading-oriented lists       (medium)
//   wide    - data tables, dashboards, detail grids  (full, inherits layout cap)
export type PageWidth = "form" | "content" | "wide";

// Exported so a route's loading skeleton renders at the same width as the page
// it stands in for, otherwise the content jumps sideways when the data lands.
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
  options: { value: string; label: string; icon: (p: { className?: string }) => React.ReactNode }[];
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
  /** Usually a string; a node when the page lets you edit the title in place
   *  (the budget page does). Typing it narrower than that is what sent that
   *  page around the shell to compose its own header. */
  title: React.ReactNode;
  /**
   * A second identifying line under the title, in the title's weight but
   * smaller, for a page whose subject is named twice, like a budget's year and
   * which budget for that year it is.
   *
   * There is no description line. Every page used to carry one, a sentence
   * under the title explaining the page, and they were removed together: a
   * screen that needs a sentence to say what it is has a title to fix, and the
   * ones that did not need it were paying a line of height on every visit.
   */
  subtitle?: React.ReactNode;
  /**
   * Which collection this page is a list of: "Mina / Alla", "Att bokföra /
   * Bokförda". See components/ui/collection-switch.tsx.
   *
   * A prop of the shell rather than something a page renders, because the
   * question is the same on every screen that asks it and used to be answered
   * in a different control, in a different place, on each of them. The title
   * does not change with it: the track is what says which collection you are
   * on, and a heading repeating it is one more thing to keep in step.
   *
   * The only thing beside the title, and deliberately. There is no `action`
   * slot: a header says what you are looking at, and what you can do to it
   * belongs to the thing itself. A list's create button on its own toolbar
   * (DataTable's `action`), an object's actions in the header of the card that
   * describes it. The slot that used to be here held all three of those at
   * once, which is why every page put a different kind of thing in it.
   */
  collections?: Collections;
  /**
   * The parts of one record, for a nested page whose record has parts of its
   * own (a bokslut year). Underlined links under the title, each part its own
   * page. Not `collections`, which only ever says whose. See
   * docs/navigation.md.
   */
  pages?: PageTabsProps;
  /**
   * How the same content is drawn: Tabell or Diagram, detail or frame. Icons,
   * on a strip of its own at the top of the page, above what it redraws. Never
   * in the band, where the scope switch is: a toggle there read as one more
   * "whose", which it is not. See docs/navigation.md.
   */
  views?: Views;
  /**
   * Which moment the page describes, for a page whose every figure moves with
   * it: the stock list's "per datum", which re-prices the whole shelf and every
   * row on it as of a past day. Drawn where the collection switch is, because
   * it answers the same question, "which view of this am I looking at", only
   * with a day instead of a set of options.
   *
   * View state and nothing else. It is not a way back to the `action` slot
   * that used to live here (see `collections`): a button, a link or a form
   * that acts on the page does not go in it, however short of room the page
   * is. A page has a collection switch or a view control, never both.
   */
  view?: React.ReactNode;
  /**
   * Keep the collection switch's room but not the switch. For a page whose
   * switch only applies some of the time (the ledger's Tabell/Diagram, which a
   * balansrapport has no use for): taking it away outright made the header a
   * few pixels shorter, and everything below jumped each time the report
   * changed. Invisible and inert, so it is not there to a pointer, a keyboard
   * or a screen reader, only to the layout.
   */
  collectionsHidden?: boolean;
  /**
   * The parent this page sits under. Shows a back link above the title, which
   * goes back in history and lands here only when there is no history to go
   * back through. Only for nested pages. The ones reachable from the sidebar
   * are their own starting point, and the sidebar is the way back out of them.
   */
  back?: string;
  /**
   * Controls on the title's own line, at its far end, for a page whose header
   * holds state that applies to the whole of it: the budget's comparison and
   * its lock. Not an action slot (see `collections`): what acts on a list or a
   * card still belongs to that list or card.
   */
  aside?: React.ReactNode;
  width?: PageWidth;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn(PAGE_WIDTH[width], className)}>
      {/* Sectioned, not merely separated: blocks on a page stand 16px apart, and
          the header sits 24px above the first of them. The header itself is
          drawn by PageHeader, which also knows whether this page is in a
          section of the nav and draws the section's tabs if so. */}
      <PageHeader
        title={title}
        subtitle={subtitle}
        back={back}
        aside={aside}
        right={
          collections ? (
            <div className={cn(collectionsHidden && "invisible")} inert={collectionsHidden}>
              <CollectionSwitch {...collections} />
            </div>
          ) : (
            view
          )
        }
      />

      {(pages || views) && (
        <div className={cn("mb-4 flex items-end justify-between gap-4", pages && "border-b border-border")}>
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
