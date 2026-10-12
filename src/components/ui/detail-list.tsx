// A bordered label/value list, the read-only summary used by the profile and
// by the wizard's final review step.
export function DetailList({ children }: { children: React.ReactNode }) {
  return (
    <dl className="divide-y divide-border rounded-panel border border-border">
      {children}
    </dl>
  );
}

export function DetailRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    // `min-w-0` on both halves, and it is load-bearing rather than defensive.
    // A flex item defaults to `min-width: auto`, which means it refuses to
    // shrink below its content, so a long label or a long value pushed this row
    // wider than the <dl> around it and every container above that let it
    // through. A contract's notes did exactly that.
    //
    // `items-start`, not `items-center`: a value that now wraps to three lines
    // should sit level with its label's first line rather than floating in the
    // middle of them.
    <div className="flex items-start justify-between gap-4 px-4 py-2.5 text-sm">
      <dt className="min-w-0 text-muted">{label}</dt>
      {/* `break-words` so an unbroken run (a URL, an org number somebody typed
          without spaces) wraps rather than deciding the row's width. */}
      <dd className="min-w-0 break-words text-right font-medium">{value}</dd>
    </div>
  );
}
