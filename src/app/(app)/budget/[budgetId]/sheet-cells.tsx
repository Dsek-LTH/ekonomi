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
  // Each in its group's own tint, under its own heading (COMPARE_GROUP), so
  // which figure is the budget, which is what happened and which is the gap
  // between them is read off where it stands rather than worked out.
  return (
    <>
      <td className={cn(COMPARE_GROUP.other, "whitespace-nowrap px-2 py-1.5 text-right tabular-nums", strong && "font-semibold")}>
        {fmt(other)}
      </td>
      <td className={cn(COMPARE_GROUP.diff, "whitespace-nowrap px-2 py-1.5 text-right tabular-nums", strong && "font-semibold", diff !== undefined && diffClass(diff, incomeLike))}>
        {fmtSigned(diff)}
      </td>
    </>
  );
}

/**
 * The comparison's two columns as groups apart from the budget's own: a heavier
 * rule where the budget ends, and a tint each, the same on the group heading,
 * the column heading and every cell, so a column reads as one band down the
 * sheet.
 */
export const COMPARE_GROUP = {
  other: "border-l-2 border-border bg-surface/70",
  diff: "border-l border-border/60 bg-surface/35",
};

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
