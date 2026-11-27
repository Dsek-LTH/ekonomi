import { cn } from "@/lib/ui/utils";

/**
 * A surface that stands on the page: drawn by the step from the canvas and a soft shadow, not by a line. The border
 * is kept in the box in --color-edge (transparent on a light page, a hairline in dark) so nothing moves between
 * themes. For something that floats above the page (a menu, a popover) use --shadow-pop and a border instead.
 */
export const SURFACE = "rounded-panel border border-edge bg-background shadow-card";

export function Card({ className, children, ...rest }: React.ComponentProps<"div">) {
  return (
    // `data-card`: a page's card runs to the screen's edges on a phone (globals.css, "Cards on the phone").
    <div data-card="" {...rest} className={cn(SURFACE, className)}>
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  subtitle,
  action,
}: {
  title?: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 px-inset pt-4 pb-1">
      {/* break-words, not truncate: Swedish compounds have nothing to wrap at and overflow the card. Subtitle is clamped; full text is on title. */}
      <div className="min-w-0">
        {title && <h2 className="break-words text-base font-semibold">{title}</h2>}
        {subtitle && (
          <p
            title={subtitle}
            className={cn("line-clamp-2 break-words text-sm text-muted", title && "mt-0.5")}
          >
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

/** A lighter section inside a Card: a tint, no border or shadow, no padding. `dashed` marks a form not yet part of the record. */
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
      className={cn(
        "rounded-control",
        dashed ? "border border-dashed border-border" : "bg-surface",
        className,
      )}
    >
      {children}
    </div>
  );
}
