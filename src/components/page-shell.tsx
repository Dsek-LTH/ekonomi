import { BackLink } from "@/components/back-link";
import { CollectionSwitch, type Collections } from "@/components/ui/collection-switch";
import { PageTitle } from "@/components/shell/settings-title";
import { cn } from "@/lib/ui/utils";

// Standard page wrapper: a header that says what you are looking at, one of
// three content widths, and uniform vertical rhythm between major blocks.
// Every page composes the same way: <PageShell title=… width=…>…</PageShell>.
//
// The header is identity and nothing else: title, description, and which
// collection of things this is (`collections`, beside the title). What you can
// *do* is not here: it belongs to the thing you would do it to, so a list's
// create button rides its own toolbar (DataTable's `action`) and an object's
// actions ride the header of the card that describes it.
//
//   form    – single-object forms / focused flows   (narrow)
//   content – settings, reading-oriented lists       (medium)
//   wide    – data tables, dashboards, detail grids  (full, inherits layout cap)
export type PageWidth = "form" | "content" | "wide";

// Exported so a route's loading skeleton renders at the same width as the page
// it stands in for, otherwise the content jumps sideways when the data lands.
export const PAGE_WIDTH: Record<PageWidth, string> = {
  form: "mx-auto max-w-2xl",
  content: "mx-auto max-w-6xl",
  wide: "",
};

export function PageShell({
  title,
  subtitle,
  description,
  collections,
  collectionsHidden = false,
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
   * title's weight but smaller, for a page whose subject is named twice, like
   * a budget's year and which budget for that year it is. The description
   * below stays what it always is: the notes about that subject.
   */
  subtitle?: React.ReactNode;
  description?: React.ReactNode;
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
  width?: PageWidth;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn(PAGE_WIDTH[width], className)}>
      {/* Sectioned, not merely separated: blocks on a page stand 16px apart, and
          the header sits 24px above the first of them. That step is enough to
          say "this names everything below" without leaving a band of empty
          page under every title. */}
      <div className="mb-6">
        {/* Above the title. See components/back-link.tsx. */}
        {back && <BackLink href={back} />}
        {/* The switch rides the title's line: it names the same thing the title
            does, only more precisely, and the two read as one heading. `gap-4`
            and `flex-wrap` so a long title drops it to the next line rather
            than squeezing it. `items-start` keeps it level with the title
            itself and not with the description below. */}
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
          <div className="min-w-0">
            {/* In the settings overlay, drawn in its top bar instead. See
                components/shell/settings-title.tsx. */}
            <PageTitle>{title}</PageTitle>
            {subtitle && <p className="mt-1 text-lg font-medium tracking-tight">{subtitle}</p>}
            {/* Further from the title than the subtitle is. The subtitle names
                the same subject a second time and belongs tight to it; the
                description is a different kind of thing and reads as one when
                it is given the room to. */}
            {description && (
              <p className="mt-2 max-w-prose text-[15px] text-muted">{description}</p>
            )}
          </div>
          {collections && (
            <div className={cn(collectionsHidden && "invisible")} inert={collectionsHidden}>
              <CollectionSwitch {...collections} />
            </div>
          )}
        </div>
      </div>

      <div className="space-y-4">{children}</div>
    </div>
  );
}
