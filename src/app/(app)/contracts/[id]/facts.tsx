// A flat grid of labelled facts, for reading a record inside a card.
//
// Not DetailList. That draws its own rounded border, which suits a list
// standing on a page (the profile, the wizard's review step) and reads as a
// second card when it is put inside one. Here the card is the frame, so the
// facts sit straight on it: a small label over each value, two across where
// the column is wide enough.
//
// A container query rather than a viewport breakpoint, because this page sits
// beside a document panel that can be dragged, so its width changes while the
// viewport does not.
export function Facts({ children }: { children: React.ReactNode }) {
  return (
    <div className="@container">
      <dl className="grid gap-x-8 gap-y-4 @md:grid-cols-2">{children}</dl>
    </div>
  );
}

export function Fact({
  label,
  wide = false,
  children,
}: {
  label: string;
  /** Takes the whole row, for prose that would be cramped in half of one. */
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={wide ? "min-w-0 @md:col-span-2" : "min-w-0"}>
      <dt className="text-xs font-medium text-muted">{label}</dt>
      <dd className="mt-0.5 break-words text-sm">{children}</dd>
    </div>
  );
}
