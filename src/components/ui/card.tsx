import { cn } from "@/lib/ui/utils";

export function Card({ className, children, ...rest }: React.ComponentProps<"div">) {
  return (
    <div {...rest} className={cn("rounded-panel border border-border bg-background", className)}>
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
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-b border-border px-inset py-3">
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
