"use client";

// One half of a budget sheet, Intäkter or Kostnader, as a card. Draws the head and foot and
// delegates the rows. There is no heading row: the section's name stands in the column header
// in place of "Beskrivning", and its total is in the summary above the sheet.
import type { AccountKind } from "@/lib/budget";
import type { JoinedAccount } from "@/lib/budget/compare";
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
}: {
  kind: AccountKind;
  label: string;
  accts: Account[];
  ghosts: JoinedAccount[];
}) {
  const { columns, compare, gutWidth, actionsWidth, narrow, showCompare, staticWidth, tCol } =
    useSheet();
  const tGroup = useTranslations("budget.compareGroups");

  return (
    <div className="budget-grid overflow-x-auto rounded-panel border border-border bg-background">
      {/* Separate borders, not collapsed: each cell owns its rules, so a row carried by the
          drag (cost-center-sheet.tsx) takes its column rules along. Row rules are therefore on
          the cells (`*:border-t`), since a <tr> or <tbody> border is not drawn in this model. */}
      <table
        aria-label={label}
        className="w-full border-separate border-spacing-0 text-sm table-fixed"
      >
        <colgroup>
          <col style={{ width: gutWidth }} />
          {columns.map((col) => {
            const w = staticWidth(col);
            return <col key={col.key} style={w ? { width: w } : undefined} />;
          })}

          {showCompare && <col style={{ width: 140 }} />}
          {showCompare && <col style={{ width: 128 }} />}
          <col style={{ width: actionsWidth }} />
        </colgroup>
        <thead>
          {showCompare && compare && (
            <tr className="text-xs font-medium text-muted *:border-b">
              <th colSpan={columns.length + 1} className="px-2 py-1 text-left">
                {tGroup("budget")}
              </th>
              <th className={cn(COMPARE_GROUP.other, "whitespace-nowrap px-2 py-1 text-right")}>
                {tGroup("other")}
              </th>
              <th className={cn(COMPARE_GROUP.diff, "whitespace-nowrap px-2 py-1 text-right")}>
                {tGroup("diff")}
              </th>
              <th />
            </tr>
          )}
          <tr className="text-left text-xs font-medium text-muted *:border-b">
            {narrow ? (
              <th className="p-0" />
            ) : (
              <th className="select-none border-r border-border/60 px-1 py-1 text-center text-[11px] text-muted">
                #
              </th>
            )}
            {columns.map((col) => (
              <Hc
                key={col.key}
                align={col.kind === "number" ? "right" : undefined}
                ruled={col.key !== "expression"}
              >
                {col.key === "beskrivning" ? (
                  <span className="text-sm font-semibold text-foreground">{label}</span>
                ) : col.custom ? (
                  col.name
                ) : (
                  tCol(col.name)
                )}
              </Hc>
            ))}
            {showCompare && compare && (
              <th
                className={cn(
                  COMPARE_GROUP.other,
                  "truncate whitespace-nowrap px-2 py-1 text-right font-medium",
                )}
                title={compare.label}
              >
                {compare.label}
              </th>
            )}
            {showCompare && (
              <th
                title={tGroup("diffHint")}
                className={cn(
                  COMPARE_GROUP.diff,
                  "whitespace-nowrap px-2 py-1 text-right font-medium",
                )}
              >
                {tGroup("diffColumn")}
              </th>
            )}
            <th />
          </tr>
        </thead>
        {accts.map((a) => (
          <AccountBlock key={a.id} account={a} />
        ))}
        {ghosts.map((g) => (
          <GhostAccountBlock key={g.code} account={g} />
        ))}

        {!showCompare && <AddAccountRow kind={kind} />}
      </table>
    </div>
  );
}
