import { cn } from "@/lib/ui/utils";

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-background px-6 py-16 text-center">
      <p className="text-base font-semibold">{title}</p>
      {description && (
        <p className="mt-1 max-w-sm text-sm text-muted">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

// "Nothing here" inside a card or list, where the full EmptyState would be too
// loud. One centred line where the rows would have been.
//
// The spacing is a named variant rather than something a caller layers on with
// `className`: cn() only concatenates, and Tailwind emits its utilities in scale
// order, so an appended `py-3` would silently lose to the default `py-10`.
const NOTE_PADDING = {
  card: "px-6 py-10", // in place of a card's rows
  compact: "px-4 py-3", // in a sidebar or another narrow column
  page: "py-12", // standing in for a whole screen
};

export function EmptyNote({
  children,
  size = "card",
  className,
}: {
  children: React.ReactNode;
  size?: keyof typeof NOTE_PADDING;
  className?: string;
}) {
  return (
    <p className={cn(NOTE_PADDING[size], "text-center text-sm text-muted", className)}>
      {children}
    </p>
  );
}
