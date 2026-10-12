import { cn } from "@/lib/ui/utils";

// The app's one raised surface: `rounded-panel`, a hairline, and an elevation
// that carries both an offset and a blur (see DESIGN.md). Anything that wants
// to look like a card should be one rather than restate those four classes,
// that is how surfaces end up a shadow apart from each other.
//
// The rest of the div's props pass through, so a surface that is also something
// (a dialog with `role="alertdialog"`, a list panel) doesn't need a wrapper
// element just to carry its attributes.
export function Card({
  className,
  children,
  ...rest
}: React.ComponentProps<"div">) {
  return (
    <div
      {...rest}
      className={cn(
        "rounded-panel border border-border bg-background shadow-[var(--shadow-card)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  subtitle,
  action,
}: {
  /**
   * Left out where the page heading above already says it, which on a page
   * that is one card is most of the time. The header is then the card's
   * toolbar: the subtitle if there is one, and the action at the right.
   */
  title?: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    // The action slot holds anything from a link to a file picker to a small
    // form, so on a narrow screen it wraps onto its own line under the title
    // rather than squeezing both.
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-b border-border px-inset py-3">
      {/* `min-w-0` alone was not enough, which is the trap: it lets the box
          shrink, and then the text inside it refuses to. A booking description,
          a cost-centre name, a receipt filename, in Swedish these are single
          unbroken compounds with nothing to wrap at, so they ran straight past
          the card's edge and took the page's width with them. The verification
          card was where it showed, but the bug was here and every card had it.
          `break-words` rather than `truncate` on the title: a title that used to
          wrap onto a second line should keep doing that, and only the string
          that cannot wrap needs forcing. The subtitle is clamped as well, so a
          long one cannot grow the header without limit; its full text is on the
          element for a pointer, and in the card below for everyone else. */}
      <div className="min-w-0">
        {title && <h2 className="break-words text-base font-semibold">{title}</h2>}
        {subtitle && (
          <p title={subtitle} className={cn("line-clamp-2 break-words text-sm text-muted", title && "mt-0.5")}>
            {subtitle}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}

export function CardBody({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return <div className={cn("px-inset py-4", className)}>{children}</div>;
}

/**
 * A lighter section within a `Card`: a tint one step off the card's own
 * background, no border, no shadow. For content that belongs to the card
 * around it and only needs to be told apart from it, not boxed separately.
 *
 * Replaces the ad hoc `rounded-xl border border-border p-4` a few screens
 * had each grown on their own: a bordered box the same shape as `Card` but
 * smaller reads as a second card stacked inside the first rather than as one
 * card with a part of it set off, which is the thing a reader notices before
 * they can say why a page looks busy. No padding baked in, on purpose: unlike
 * `CardBody`'s fixed `px-inset py-4`, what sits inside one of these varies
 * enough (a short callout, a form, a table) that a caller's own `className`
 * has to be free to set it, and a default here would either be wrong for most
 * of them or fight a caller's own value for the same property.
 *
 * `dashed` is the one genuinely different case: a form that is not yet part
 * of the record (adding a contract party, recording a rental's return)
 * rather than a settled fact about one that already is. A dashed edge is the
 * same "nothing here yet" signal a draft or an empty dropzone already
 * carries elsewhere in the app, and is worth keeping distinct from the tint
 * every settled section uses.
 */
export function InsetPanel({
  dashed = false,
  className,
  children,
  ...rest
}: {
  dashed?: boolean;
} & React.ComponentProps<"div">) {
  return (
    <div
      {...rest}
      className={cn("rounded-control", dashed ? "border border-dashed border-border" : "bg-surface", className)}
    >
      {children}
    </div>
  );
}
