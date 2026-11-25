"use client";

// A budget sheet as one grid, as a spreadsheet reads: one column header for the whole sheet,
// then Intäkter and Kostnader, each opened by a heading row with its own row number and total
// (the rows lib/budget/grid.ts has always counted). Delegates the account rows.
import type { AccountKind } from "@/lib/budget";
import type { JoinedAccount } from "@/lib/budget/compare";
import { AccountBlock, AddAccountRow, GhostAccountBlock } from "./sheet-account";
import { COMPARE_GROUP, CompareCells, Hc } from "./sheet-cells";
import { useSheet } from "./sheet-context";
import { fmt } from "./budget-helpers";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/ui/utils";
import type { Account } from "./budget-types";

interface Section {
  kind: AccountKind;
  label: string;
  accts: Account[];
  ghosts: JoinedAccount[];
}

// The column widths, shared by the grid and the header pinned in the totals card
// (cost-center-sheet.tsx), so the two tables line up column for column.
function SheetCols() {
  const { columns, gutWidth, actionsWidth, showCompare, staticWidth } = useSheet();
  return (
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
  );
}

function SheetHeadRows() {
  const { columns, compare, narrow, showCompare, tCol } = useSheet();
  const tGroup = useTranslations("budget.compareGroups");
  return (
    <>
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
            {col.custom ? col.name : tCol(col.name)}
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
            className={cn(COMPARE_GROUP.diff, "whitespace-nowrap px-2 py-1 text-right font-medium")}
          >
            {tGroup("diffColumn")}
          </th>
        )}
        <th />
      </tr>
    </>
  );
}

/**
 * The column header as the foot of the pinned totals card, from md. A table of its own with
 * the grid's widths (SheetCols), so it stays put while the grid scrolls under it.
 */
export function SheetHeader() {
  return (
    <div className="budget-grid">
      <table className="w-full border-separate border-spacing-0 text-sm table-fixed">
        <SheetCols />
        <thead>
          <SheetHeadRows />
        </thead>
      </table>
    </div>
  );
}

/**
 * The rows. From md the grid hangs from the totals card, which holds its header (SheetHeader):
 * no top edge of its own. On a phone, with no card, it keeps its own header.
 */
export function SheetGrid({ sections }: { sections: Section[] }) {
  return (
    // From md, `overflow-clip` rather than auto: a scrolling box would hold the pinned card's
    // rows inside itself, and a clip still rounds the corners.
    <div className="budget-grid overflow-x-auto rounded-panel border border-border bg-background md:overflow-clip md:rounded-t-none md:border-t-0">
      {/* Separate borders, not collapsed: each cell owns its rules, so a row carried by the
          drag (cost-center-sheet.tsx) takes its column rules along. Row rules are therefore on
          the cells (`*:border-t`), since a <tr> or <tbody> border is not drawn in this model. */}
      <table className="w-full border-separate border-spacing-0 text-sm table-fixed">
        <SheetCols />
        <thead className="md:hidden">
          <SheetHeadRows />
        </thead>
        {sections.map((s, i) => (
          <SectionRows key={s.kind} section={s} first={i === 0} />
        ))}
      </table>
    </div>
  );
}

function SectionRows({ section, first }: { section: Section; first: boolean }) {
  const { kind, label, accts, ghosts } = section;
  const { badAccount, ccCode, columns, compareTotals, grid, gut, showCompare, totals } = useSheet();
  const total = kind === "INCOME" ? totals.income : totals.cost;
  const other = kind === "INCOME" ? compareTotals.income : compareTotals.cost;
  // Short while a row on this side does not resolve, as on the account rows.
  const incomplete = accts.some((a) => badAccount.has(`${ccCode}:${a.accountCode}`));

  return (
    <>
      <tbody>
        {/* The section's heading: the name where a description goes and its total under Belopp,
            ruled off below, with a heavier rule above Kostnader where the halves meet. */}
        <tr className={cn("bg-background *:border-b", !first && "*:border-t-2")}>
          {gut(grid.sectionRow.get(`${ccCode}|${kind}`))}
          <td
            className="border-r border-border/60 px-3 py-1.5 font-semibold"
            colSpan={columns.length - 1}
          >
            {label}
          </td>
          <td
            className={cn(
              "px-2 py-1.5 text-right font-semibold tabular-nums",
              incomplete && "text-warning",
            )}
          >
            {fmt(total)}
          </td>
          {showCompare && (
            <CompareCells other={other} own={total} incomeLike={kind === "INCOME"} strong />
          )}
          <td />
        </tr>
      </tbody>
      {accts.map((a) => (
        <AccountBlock key={a.id} account={a} />
      ))}
      {ghosts.map((g) => (
        <GhostAccountBlock key={g.code} account={g} />
      ))}
      {!showCompare && <AddAccountRow kind={kind} />}
    </>
  );
}
