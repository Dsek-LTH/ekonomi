"use client";

// One half of a budget sheet, Intäkter or Kostnader, as a rounded card.
//
// It draws the table's head and foot and delegates every row inside it. As a
// closure it captured twenty-one things for forty-seven lines, most of them
// only to pass down; against the sheet context it needs twelve and forwards
// none of them.
import type { AccountKind } from "@/lib/budget";
import type { JoinedAccount } from "@/lib/budget/compare";
import { fmt } from "./budget-helpers";
import { AccountBlock, AddAccountRow, GhostAccountBlock } from "./sheet-account";
import { COMPARE_GROUP, Hc } from "./sheet-cells";
import { useSheet } from "./sheet-context";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/ui/utils";
import type { Account } from "./budget-types";

export function SectionCard({
  kind,
  label,
  accts,
  ghosts,
  total,
}: {
  kind: AccountKind;
  label: string;
  accts: Account[];
  ghosts: JoinedAccount[];
  total: number;
}) {
  const {
    columns,
    compare,
    gutWidth,
    actionsWidth,
    narrow,
    showCompare,
    staticWidth,
    tCol,
  } = useSheet();
  const tGroup = useTranslations("budget.compareGroups");
  // No longer a drop zone. An account used to be dragged onto the other card to
  // reclassify it; its number decides the side now, so the card is just a card.
  return (
    <div className="budget-grid overflow-x-auto rounded-panel border border-border bg-background">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold">
          {label}
        </h3>
        <span className="text-sm tabular-nums text-muted">{fmt(total)}</span>
      </div>
      <table className="w-full border-collapse text-sm table-fixed">
        <colgroup>
          <col style={{ width: gutWidth }} />
          {columns.map((col) => { const w = staticWidth(col); return <col key={col.key} style={w ? { width: w } : undefined} />; })}
          {/* Wide enough for their headings on one line ("Utfall 2026",
              "Jämfört med") and a six-figure amount with its sign. At 104 and
              96 the headings wrapped. */}
          {showCompare && <col style={{ width: 140 }} />}
          {showCompare && <col style={{ width: 128 }} />}
          <col style={{ width: actionsWidth }} />
        </colgroup>
        <thead>
          {/* The groups, over the columns: what this budget says, what it is
              compared with, and the gap between the two. Only when there is a
              comparison to group. */}
          {showCompare && compare && (
            <tr className="border-b border-border/60 text-xs font-medium text-muted">
              <th colSpan={columns.length + 1} className="px-2 py-1.5 text-left">
                {tGroup("budget")}
              </th>
              <th className={cn(COMPARE_GROUP.other, "whitespace-nowrap px-2 py-1.5 text-right")}>{tGroup("other")}</th>
              <th className={cn(COMPARE_GROUP.diff, "whitespace-nowrap px-2 py-1.5 text-right")}>{tGroup("diff")}</th>
              <th />
            </tr>
          )}
          <tr className="border-b border-border text-left text-xs font-medium text-muted">
            {narrow ? (
              <th className="p-0" />
            ) : (
              <th className="select-none border-r border-border/60 px-1 py-2 text-center font-mono text-[10px] text-muted">#</th>
            )}
            {columns.map((col) => (
              <Hc key={col.key} letter={col.letter} align={col.kind === "number" ? "right" : undefined}>{col.custom ? col.name : tCol(col.name)}</Hc>
            ))}
            {showCompare && compare && (
              <th className={cn(COMPARE_GROUP.other, "truncate whitespace-nowrap px-2 py-2 text-right font-medium")} title={compare.label}>{compare.label}</th>
            )}
            {showCompare && (
              <th title={tGroup("diffHint")} className={cn(COMPARE_GROUP.diff, "whitespace-nowrap px-2 py-2 text-right font-medium")}>
                {tGroup("diffColumn")}
              </th>
            )}
            <th className="border-l border-border/60" />
          </tr>
        </thead>
        {accts.map((a) => (
          <AccountBlock key={a.id} account={a} />
        ))}
        {ghosts.map((g) => (
          <GhostAccountBlock key={g.code} account={g} />
        ))}
        {/* Adding an account is writing the budget, which the comparison's
            reading view leaves for when it is switched off. */}
        {!showCompare && <AddAccountRow kind={kind} />}
      </table>
    </div>
  );
}
