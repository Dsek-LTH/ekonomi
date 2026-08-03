// The frame-budget overview: every cost centre's income/cost/result, grouped by
// result unit with subtotals and a grand total. Rows link into their sheet.
//
// The rows come from the comparison join (lib/budget/compare.ts), which is what
// puts a cost centre the other side budgets for — or spent on — in this table
// even though this budget has no sheet for it. Such a row has nothing of its own
// to show and nowhere to click through to, and says so. When nothing is being
// compared the join holds one side, and the table is exactly this budget.
import { useTranslations } from "next-intl";
import { cn } from "@/lib/ui/utils";
import { sheetTotals, ZERO_TOTALS, type JoinedSheet, type Totals } from "@/lib/budget/compare";
import { resultUnitLabel, resultUnitOfSheet, diffClass, fmt, fmtSigned, groupByResultUnit } from "./budget-helpers";
import type { Comparison } from "./use-comparison";

const numCls = "px-3 py-1.5 text-right tabular-nums";

// A sheet with both sides totalled once; the rows, the subtotals and the grand
// total all read from these. `impact` is how much of `own.result` comes from
// editorial changes rather than from the adopted figures.
type Row = { sheet: JoinedSheet; own: Totals; other: Totals; impact: number };
type Pair = { own: Totals; other: Totals; impact: number };

const add = (a: Totals, b: Totals): Totals =>
  ({ income: a.income + b.income, cost: a.cost + b.cost, result: a.result + b.result });

const sum = (rows: Row[]): Pair => rows.reduce<Pair>(
  (a, r) => ({ own: add(a.own, r.own), other: add(a.other, r.other), impact: a.impact + r.impact }),
  { own: ZERO_TOTALS, other: ZERO_TOTALS, impact: 0 },
);

export function Rambudget({ comparison, ccIdOf, impactOf, showImpact, onPick }: {
  comparison: Comparison;
  /** The sheet in THIS budget a joined row belongs to, if it has one. */
  ccIdOf: (key: string) => string | undefined;
  /** What editorial changes have done to that sheet's result. */
  impactOf: (key: string) => number | undefined;
  /** Whether the budget has any at all — no column until it does. */
  showImpact: boolean;
  onPick: (id: string) => void;
}) {
  const t = useTranslations("budget.rambudget");
  const tGroup = useTranslations("budget.group");
  const tAlloc = useTranslations("allocation");
  const showCompare = comparison.otherLabel !== null;

  const rows: Row[] = comparison.joined.sheets.map((sheet) => ({
    sheet,
    own: sheetTotals(sheet, 0),
    other: showCompare ? sheetTotals(sheet, 1) : ZERO_TOTALS,
    impact: impactOf(sheet.key) ?? 0,
  }));
  const groups = groupByResultUnit(rows, (r) => resultUnitOfSheet(r.sheet));

  return (
    // The card is its own scrollport from lg up: the table scrolls inside it
    // while the header block stays put at the top, so the page itself barely
    // moves. Below lg it keeps its natural height and flows with the page —
    // a nested vertical scroller on a phone is more trouble than it is worth.
    <div className="rambudget budget-grid overflow-x-auto rounded-2xl border border-border bg-background lg:max-h-[70vh] lg:overflow-y-auto">
      <table className="w-full border-collapse text-sm">
        {/* Column names and the grand total both sit here; the whole block pins
            as one from lg up — see `.rambudget thead` in globals.css. */}
        <thead>
          <tr className="border-b border-border text-[11px] text-muted">
            <th className="px-3 py-2 text-left font-medium">{tAlloc("costCenter")}</th>
            <th data-rule="l" className={cn("border-l border-border font-medium", numCls)}>{t("income")}</th>
            <th className={cn("font-medium", numCls)}>{t("costs")}</th>
            <th className={cn("font-medium", numCls)}>{t("result")}</th>
            {/* What the adopted budget said, beside what it says now. A transfer
                nets to nothing across its resultUnit, so this column is mostly
                deviations — which is the point of it. */}
            {showImpact && <th title={t("changesHint")} className={cn("font-medium", numCls)}>{t("changes")}</th>}
            {showImpact && <th className={cn("font-medium", numCls)}>{t("original")}</th>}
            {showCompare && <th data-rule="l" className={cn("border-l border-border font-medium", numCls)}>{comparison.otherLabel}</th>}
            {showCompare && <th className={cn("font-medium", numCls)}>Diff</th>}
          </tr>
          <tr className="border-b-2 border-border bg-surface/50 font-semibold">
            <td className="px-3 py-2">{t("total")}</td>
            <Amounts {...sum(rows)} showCompare={showCompare} showImpact={showImpact} />
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <FragmentGroup
              key={g.resultUnit}
              resultUnit={resultUnitLabel(g.resultUnit, tGroup)}
              {...sum(g.items)}
              showCompare={showCompare}
              showImpact={showImpact}
            >
              {g.items.map((row) => {
                const id = ccIdOf(row.sheet.key);
                return (
                  <tr
                    key={row.sheet.key}
                    className={cn(
                      "border-b border-border/50",
                      id ? "cursor-pointer hover:bg-surface/60" : "text-muted",
                    )}
                    onClick={id ? () => onPick(id) : undefined}
                  >
                    <td className="px-3 py-1.5">
                      {/^[@#]/.test(row.sheet.key)
                        ? row.sheet.name
                        : <><span className="font-mono text-xs text-muted">{row.sheet.key}</span>{" "}{row.sheet.name}</>}
                      {/* Only the other side has this one — there is no sheet
                          here to open, and nothing budgeted to put beside it. */}
                      {!id && <span className="ml-2 text-xs">· {t("notInThisBudget")}</span>}
                    </td>
                    <Amounts own={row.own} other={row.other} impact={row.impact} showCompare={showCompare} showImpact={showImpact} soft />
                  </tr>
                );
              })}
            </FragmentGroup>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// The numeric tail of a row — the same four/six cells whether it's one cost
// centre, a result unit subtotal or the grand total. `soft` picks the lighter
// divider used on the cost-centre rows. `data-rule="l"` marks the cells that
// carry a left divider; it only does anything in <thead>, where the pinned
// cells have to redraw their own rules (see globals.css).
function Amounts({ own, other, impact, showCompare, showImpact, soft }: {
  own: Totals; other: Totals; impact: number; showCompare: boolean; showImpact: boolean; soft?: boolean;
}) {
  const divider = soft ? "border-l border-border/50" : "border-l border-border";
  return (
    <>
      <td data-rule="l" className={cn(divider, numCls)}>{fmt(own.income)}</td>
      <td className={numCls}>{fmt(own.cost)}</td>
      <td className={cn(numCls, diffClass(own.result, true))}>{fmtSigned(own.result)}</td>
      {/* Blank rather than a zero where nothing has been changed: a column of
          "0" would read as a finding, and the finding is that there is none. */}
      {showImpact && <td className={cn(numCls, impact !== 0 && diffClass(impact, true))}>{impact === 0 ? "" : fmtSigned(impact)}</td>}
      {showImpact && <td className={cn(numCls, "text-muted")}>{impact === 0 ? "" : fmtSigned(own.result - impact)}</td>}
      {showCompare && <td data-rule="l" className={cn(divider, numCls)}>{fmtSigned(other.result)}</td>}
      {showCompare && <td className={cn(numCls, diffClass(other.result - own.result, true))}>{fmtSigned(other.result - own.result)}</td>}
    </>
  );
}

function FragmentGroup({ resultUnit, own, other, impact, showCompare, showImpact, children }: {
  resultUnit: string; own: Totals; other: Totals; impact: number;
  showCompare: boolean; showImpact: boolean; children: React.ReactNode;
}) {
  const t = useTranslations("budget.rambudget");
  return (
    <>
      <tr className="border-b border-border bg-surface/30">
        <td className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted" colSpan={4 + (showCompare ? 2 : 0) + (showImpact ? 2 : 0)}>{resultUnit}</td>
      </tr>
      {children}
      <tr className="border-b border-border text-sm font-medium">
        <td className="px-3 py-1.5 pl-6 text-muted">{t("groupTotal", { resultUnit: resultUnit.toLowerCase() })}</td>
        <Amounts own={own} other={other} impact={impact} showCompare={showCompare} showImpact={showImpact} soft />
      </tr>
    </>
  );
}
