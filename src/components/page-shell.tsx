import { BackLink } from "@/components/back-link";
import { CollectionSwitch, type Collections } from "@/components/ui/collection-switch";
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

// Where a nested page sits under its parent. A named route rather than "back":
// it says where it goes, and it goes there however you arrived: from the list,
// from a link someone sent you, or on a reload, where there is no history to go
// back through.
//
// When the page you came from *is* this route, it returns you to the screen you
// left rather than to the route's bare form. The query a list keeps its state
// in is the difference between "Alla" and "Mina". See components/back-link.tsx.
interface BackTo {
  href: string;
  /** The destination, as it reads after the arrow: "← Expenses". */
  label: string;
}

export function PageShell({
  title,
  subtitle,
  description,
  collections,
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
   * The parent this page sits under, shown as a "← <label>" link above the
   * title. Only for nested pages. The ones reachable from the sidebar are
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
        {/* Above the title, where the page it returns to reads as the thing
            this one sits under. It returns you to the list as you left it when
            that is where you came from. See components/back-link.tsx. */}
        {back && <BackLink href={back.href} label={back.label} />}
        {/* The switch rides the title's line: it names the same thing the title
            does, only more precisely, and the two read as one heading. `gap-4`
            and `flex-wrap` so a long title drops it to the next line rather
            than squeezing it. `items-start` keeps it level with the title
            itself and not with the description below. */}
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            {subtitle && <p className="mt-1 text-lg font-medium tracking-tight">{subtitle}</p>}
            {/* Further from the title than the subtitle is. The subtitle names
                the same subject a second time and belongs tight to it; the
                description is a different kind of thing and reads as one when
                it is given the room to. */}
            {description && (
              <p className="mt-2 max-w-prose text-[15px] text-muted">{description}</p>
            )}
          </div>
          {collections && <CollectionSwitch {...collections} />}
        </div>
      </div>

      <div className="space-y-6">{children}</div>
    </div>
  );
}
