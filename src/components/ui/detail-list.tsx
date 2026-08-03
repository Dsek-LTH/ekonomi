// A bordered label/value list — the read-only summary used by the profile and
// by the wizard's final review step.
export function DetailList({ children }: { children: React.ReactNode }) {
  return (
    <dl className="divide-y divide-border rounded-xl border border-border">
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
    <div className="flex items-center justify-between gap-4 px-4 py-2.5 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}
