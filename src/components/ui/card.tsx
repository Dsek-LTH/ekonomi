import { cn } from "@/lib/ui/utils";

// The app's one raised surface: `rounded-2xl`, a hairline, and an elevation
// that carries both an offset and a blur (see DESIGN.md). Anything that wants
// to look like a card should be one rather than restate those four classes —
// that is how surfaces end up a shadow apart from each other.
//
// The rest of the div's props pass through, so a surface that is also something
// — a dialog with `role="alertdialog"`, a list panel — doesn't need a wrapper
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
        "rounded-2xl border border-border bg-background shadow-[var(--shadow-card)]",
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
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    // The action slot holds anything from a link to a file picker to a small
    // form, so on a narrow screen it wraps onto its own line under the title
    // rather than squeezing both.
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-b border-border px-inset py-4">
      {/* `min-w-0` alone was not enough, which is the trap: it lets the box
          shrink, and then the text inside it refuses to. A booking description,
          a cost-centre name, a receipt filename — in Swedish these are single
          unbroken compounds with nothing to wrap at, so they ran straight past
          the card's edge and took the page's width with them. The verification
          card was where it showed, but the bug was here and every card had it.
          `break-words` rather than `truncate` on the title: a title that used to
          wrap onto a second line should keep doing that, and only the string
          that cannot wrap needs forcing. The subtitle is clamped as well, so a
          long one cannot grow the header without limit; its full text is on the
          element for a pointer, and in the card below for everyone else. */}
      <div className="min-w-0">
        <h2 className="break-words text-base font-semibold">{title}</h2>
        {subtitle && (
          <p title={subtitle} className="mt-0.5 line-clamp-2 break-words text-sm text-muted">
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
  return <div className={cn("px-inset py-5", className)}>{children}</div>;
}
