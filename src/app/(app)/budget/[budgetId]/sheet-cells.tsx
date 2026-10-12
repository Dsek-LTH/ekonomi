"use client";

// The two smallest pieces of a budget sheet's table.
//
// Shared by the account block and the section card, which is why they are here
// rather than inside either: a comparison pair is drawn against a line, against
// an account's total and against a section's, and the header letter belongs to
// the section card alone but reads as part of the same vocabulary.
import { diffClass, fmt, fmtSigned } from "./budget-helpers";
import { cn } from "@/lib/ui/utils";

/**
 * The other budget's figure and the difference from ours, as two cells.
 *
 * `incomeLike` decides which way a difference is good, see diffClass. The
 * pair is drawn together because a number with nothing to compare it to is not
 * a comparison, and the two cells share the border that separates them from
 * this sheet's own columns.
 */
// something is budgeting nothing for it.
export function CompareCells({ other, own, incomeLike, strong }: {
  other: number | undefined; own: number | undefined; incomeLike: boolean; strong?: boolean;
}) {
  const diff = other === undefined ? undefined : other - (own ?? 0);
  return (
    <>
      <td className={cn("border-l border-border/40 px-2 py-1.5 text-right tabular-nums text-muted", strong && "font-semibold")}>
        {fmt(other)}
      </td>
      <td className={cn("px-2 py-1.5 text-right tabular-nums", strong && "font-semibold", diff !== undefined && diffClass(diff, incomeLike))}>
        {fmtSigned(diff)}
      </td>
    </>
  );
}

// Column header with its A1 letter shown before the name (the six general
// columns are unnamed, so they show just their letter).
export function Hc({ letter, align, title, children }: {
  letter: string; align?: "right"; title?: string; children: React.ReactNode;
}) {
  return (
    <th title={title} className={cn("border-r border-border/60 px-2 py-2", align === "right" ? "text-right" : "text-left")}>
      <span className="mr-1 font-mono text-[10px] font-normal text-muted">{letter}</span>{children}
    </th>
  );
}
