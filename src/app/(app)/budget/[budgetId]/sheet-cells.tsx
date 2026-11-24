// Shared by the account block and the section card: a comparison pair is drawn against a
// line, an account total and a section total.
import { diffClass, fmt, fmtSigned } from "./budget-helpers";
import { cn } from "@/lib/ui/utils";

/** The other budget's figure and the difference from ours, as two cells. `incomeLike` decides which way a difference is good (diffClass). */
export function CompareCells({
  other,
  own,
  incomeLike,
  strong,
}: {
  other: number | undefined;
  own: number | undefined;
  incomeLike: boolean;
  strong?: boolean;
}) {
  const diff = other === undefined ? undefined : other - (own ?? 0);

  return (
    <>
      <td
        className={cn(
          COMPARE_GROUP.other,
          "whitespace-nowrap px-2 py-1 text-right tabular-nums",
          strong && "font-semibold",
        )}
      >
        {fmt(other)}
      </td>
      <td
        className={cn(
          COMPARE_GROUP.diff,
          "whitespace-nowrap px-2 py-1 text-right tabular-nums",
          strong && "font-semibold",
          diff !== undefined && diffClass(diff, incomeLike),
        )}
      >
        {fmtSigned(diff)}
      </td>
    </>
  );
}

/** The comparison's two columns as groups apart from the budget's own: a heavier rule where the budget ends and a tint per column. */
export const COMPARE_GROUP = {
  other: "border-l-2 border-border bg-surface/70",
  diff: "border-l border-border/60 bg-surface/35",
};

// Column header. Columns have no letters: a reference names a row (`#5`, lib/budget/grid.ts).
export function Hc({
  align,
  title,
  ruled = true,
  children,
}: {
  align?: "right";
  title?: string;
  /** A rule on the right. Off for the sheet's last column, which the actions sit beside. */
  ruled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <th
      title={title}
      className={cn(
        "px-2 py-1",
        ruled && "border-r border-border/60",
        align === "right" ? "text-right" : "text-left",
      )}
    >
      {children}
    </th>
  );
}
