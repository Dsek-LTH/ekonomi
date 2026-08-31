"use client";

// One half of a budget sheet, Intäkter or Kostnader, as a rounded card.
//
// It draws the table's head and foot and delegates every row inside it. As a
// closure it captured twenty-one things for forty-seven lines, most of them
// only to pass down; against the sheet context it needs twelve and forwards
// none of them.
import type { AccountKind } from "@/lib/budget";
import type { JoinedAccount } from "@/lib/budget/compare";
import { cn } from "@/lib/ui/utils";
import { fmt } from "./budget-helpers";
import { AccountBlock, AddAccountRow, GhostAccountBlock } from "./sheet-account";
import { Hc } from "./sheet-cells";
import { useSheet } from "./sheet-context";
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
    dropKind,
    dropProps,
    gutWidth,
    actionsWidth,
    narrow,
    showCompare,
    staticWidth,
    t,
    tCol,
    tLedger,
  } = useSheet();
  const active = dropKind === kind;
  return (
    <div
      {...dropProps(kind)}
      className={cn(
        "budget-grid overflow-x-auto rounded-2xl border bg-background transition-colors",
        active ? "border-accent ring-1 ring-accent" : "border-border",
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold">
          {label}
          {active && <span className="ml-2 text-xs font-normal text-muted">– {t("dropHere")}</span>}
        </h3>
        <span className="text-sm tabular-nums text-muted">{fmt(total)}</span>
      </div>
      <table className="w-full border-collapse text-sm table-fixed">
        <colgroup>
          <col style={{ width: gutWidth }} />
          {columns.map((col) => { const w = staticWidth(col); return <col key={col.key} style={w ? { width: w } : undefined} />; })}
          {showCompare && <col style={{ width: 104 }} />}
          {showCompare && <col style={{ width: 96 }} />}
          <col style={{ width: actionsWidth }} />
        </colgroup>
        <thead>
          <tr className="border-b border-border text-left text-xs font-medium text-muted">
            {narrow ? (
              <th className="p-0" />
            ) : (
              <th className="select-none border-r border-border/60 px-1 py-2 text-center font-mono text-[10px] text-muted/50">#</th>
            )}
            {columns.map((col) => (
              <Hc key={col.key} letter={col.letter} align={col.kind === "number" ? "right" : undefined}>{col.custom ? col.name : tCol(col.name)}</Hc>
            ))}
            {showCompare && compare && <th className="border-l border-border/60 px-2 py-2 text-right font-medium">{compare.label}</th>}
            {showCompare && <th className="border-r border-border/60 px-2 py-2 text-right font-medium">{tLedger("col.diff")}</th>}
            <th className="border-l border-border/60" />
          </tr>
        </thead>
        {accts.map((a) => (
          <AccountBlock key={a.id} account={a} />
        ))}
        {ghosts.map((g) => (
          <GhostAccountBlock key={g.code} account={g} />
        ))}
        <AddAccountRow kind={kind} />
      </table>
    </div>
  );
}
