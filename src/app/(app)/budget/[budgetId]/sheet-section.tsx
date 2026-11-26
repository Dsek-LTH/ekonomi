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
import { useLayoutEffect, useRef, type RefObject } from "react";
import { isHeaderKey } from "./use-range-select";
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
            title={tGroup(compare?.vsActuals ? "diffHintActuals" : "diffHintBudget")}
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
  const wrap = useRef<HTMLDivElement>(null);
  return (
    // From md, `overflow-clip` rather than auto: a scrolling box would hold the pinned card's
    // rows inside itself, and a clip still rounds the corners.
    <div
      ref={wrap}
      className="budget-grid relative overflow-x-auto rounded-panel border border-border bg-background md:overflow-clip md:rounded-t-none md:border-t-0"
    >
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
      <RangeBox wrap={wrap} />
      <AccountBox wrap={wrap} />
      <HeldBoxes wrap={wrap} />
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

/**
 * A box laid over the grid from the cell `from` names to the cell `to` names (selectors inside
 * the grid), as a spreadsheet draws a selection: one box, so the cells' own rules do
 * not cut it into strips. Inside the scrolling wrapper, so it moves with the rows; measured
 * again when the grid resizes. Draws nothing while either cell is missing.
 */
function GridBox({
  wrap,
  from,
  to,
  className,
}: {
  wrap: RefObject<HTMLDivElement | null>;
  from: string;
  to: string;
  className: string;
}) {
  // Placed by writing its own style, not through state: it is measured again on every render,
  // and a state update there would render again in turn.
  const self = useRef<HTMLDivElement>(null);

  const measure = () => {
    const el = wrap.current;
    const box = self.current;
    if (!el || !box) return;
    const a = el.querySelector<HTMLElement>(from);
    const b = el.querySelector<HTMLElement>(to);
    // Hidden while either cell is missing (scrolled into another sheet, a line just deleted).
    box.hidden = !a || !b;
    if (!a || !b) return;
    const origin = el.getBoundingClientRect();
    const ra = a.getBoundingClientRect();
    const rb = b.getBoundingClientRect();
    // An absolute child is placed from inside the wrapper's border, the rect from outside it.
    // Snapped to whole device pixels, as the cells' own borders are drawn: a box at a
    // fractional place drew its lines thicker on some sides than others.
    const dpr = window.devicePixelRatio || 1;
    const snap = (v: number) => Math.round(v * dpr) / dpr;
    const top = snap(ra.top - origin.top - el.clientTop + el.scrollTop);
    const left = snap(ra.left - origin.left - el.clientLeft + el.scrollLeft);
    box.style.top = `${top}px`;
    box.style.left = `${left}px`;
    box.style.width = `${snap(rb.right - origin.left - el.clientLeft + el.scrollLeft) - left}px`;
    box.style.height = `${snap(rb.bottom - origin.top - el.clientTop + el.scrollTop) - top}px`;
  };
  // Again on every render: rows can move without the grid changing size (a row dragged to
  // another account), which the observer alone would not notice.
  useLayoutEffect(measure);
  useLayoutEffect(() => {
    const table = wrap.current?.querySelector("table");
    if (!table) return;
    const ro = new ResizeObserver(measure);
    ro.observe(table);
    return () => ro.disconnect();
    // `measure` reads `from` and `to`, which are the deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, wrap]);

  // Its layer is the caller's (`className`): over the cells, and under the pinned card (z-15).
  return (
    <div ref={self} aria-hidden hidden className={cn("pointer-events-none absolute", className)} />
  );
}

// A cell of a line, or of an account's own row (its key from headerKey, use-range-select.ts).
const lineCell = (line: string, col: string) =>
  isHeaderKey(line)
    ? `tr[data-account-row="${CSS.escape(line.slice("acct:".length))}"] > td${col}`
    : `tr[data-line="${CSS.escape(line)}"] > td${col}`;

/**
 * The block of selected cells (use-range-select.ts): tinted, with the selected cell's graphite
 * outline (globals.css), since pink in the sheet means editing.
 */
function RangeBox({ wrap }: { wrap: RefObject<HTMLDivElement | null> }) {
  const { range } = useSheet();
  // Whole rows selected, perhaps apart (⌘-click): a box for each run of them, across the row.
  if (range.rows.length > 0)
    return range.runs.map((run) => (
      <GridBox
        key={run[0]}
        wrap={wrap}
        from={lineCell(run[0], '[data-range-col="0"]')}
        to={lineCell(run[run.length - 1], '[data-range-col="1"]')}
        className="z-[5] bg-action-from/15 outline outline-1 -outline-offset-1 outline-faint"
      />
    ));
  if (!range.multi || !range.rect) return null;
  const first = range.lines[0];
  const last = range.lines[range.lines.length - 1];
  return (
    <GridBox
      wrap={wrap}
      from={lineCell(first, `[data-range-col="${range.rect.left}"]`)}
      to={lineCell(last, `[data-range-col="${range.rect.right}"]`)}
      // Under the selected cell's box (z-10), which marks the active cell inside the block.
      className="z-[5] bg-action-from/15 outline outline-1 -outline-offset-1 outline-faint"
    />
  );
}

/**
 * What is copied or cut and not yet let go, framed as a spreadsheet marks it: each run of rows,
 * each account whole, the block of cells. What is cut is also faded (sheet-account.tsx). Gone
 * once a cut is pasted, or on Rensa, Escape or the next copy.
 */
function HeldBoxes({ wrap }: { wrap: RefObject<HTMLDivElement | null> }) {
  const { heldRuns, heldAccounts, heldCells } = useSheet();
  // The selected cell's box in weight and place (1px, just inside the edge: globals.css), so the
  // two lie on the same line. Dashed and in the text colour, so it does not read as a gridline.
  // Over the selected cell's box (z-10), which shares its line, and under the pinned card (z-15).
  const frame = "z-[11] outline-1 -outline-offset-1 outline-dashed outline-foreground";
  return (
    <>
      {heldRuns.map((run) => (
        <GridBox
          key={run[0]}
          wrap={wrap}
          // Beskrivning to Belopp: the row's content, not its number, grip or actions.
          from={lineCell(run[0], '[data-range-col="0"]')}
          to={lineCell(run[run.length - 1], '[data-range-col="1"]')}
          className={frame}
        />
      ))}
      {heldAccounts.map(({ id, lastLine }) => (
        <GridBox
          key={id}
          wrap={wrap}
          // The account's name, then down to its last line's Belopp, or its own total if it has
          // no lines yet. Not the number, the margin or the actions.
          from={`tr[data-account-row="${CSS.escape(id)}"] > [data-account-name]`}
          to={
            lastLine
              ? lineCell(lastLine, '[data-range-col="1"]')
              : `tr[data-account-row="${CSS.escape(id)}"] > [data-account-total]`
          }
          className={frame}
        />
      ))}
      {heldCells && (
        <GridBox
          wrap={wrap}
          from={lineCell(heldCells.lines[0], `[data-range-col="${heldCells.left}"]`)}
          to={lineCell(
            heldCells.lines[heldCells.lines.length - 1],
            `[data-range-col="${heldCells.right}"]`,
          )}
          className={frame}
        />
      )}
    </>
  );
}

/**
 * Accounts picked by their numbers, as one box like a block of cells: from the first one's name
 * on its own row to the Belopp of the last one's last line (its own total, if it has none).
 */
function AccountBox({ wrap }: { wrap: RefObject<HTMLDivElement | null> }) {
  const { pickedAccounts: p } = useSheet();
  if (!p) return null;
  return (
    <GridBox
      wrap={wrap}
      from={`tr[data-account-row="${CSS.escape(p.first)}"] > [data-account-name]`}
      to={
        p.lastLine
          ? lineCell(p.lastLine, '[data-range-col="1"]')
          : `tr[data-account-row="${CSS.escape(p.last)}"] > [data-account-total]`
      }
      className="z-[5] bg-action-from/15 outline outline-1 -outline-offset-1 outline-faint"
    />
  );
}
