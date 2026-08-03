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
      <div className="min-w-0">
        <h2 className="text-base font-semibold">{title}</h2>
        {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
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
