// The frame-budget overview: every cost centre's income, cost and result grouped by result
// unit with subtotals and a grand total. Rows come from the comparison join
// (lib/budget/compare.ts), so a cost centre only the other side has appears without a sheet
// to open.
import { useTranslations } from "next-intl";
import { cn } from "@/lib/ui/utils";
import { sheetTotals, ZERO_TOTALS, type JoinedSheet, type Totals } from "@/lib/budget/compare";
import {
  resultUnitLabel,
  resultUnitOfSheet,
  diffClass,
  fmt,
  fmtSigned,
  groupByResultUnit,
} from "./budget-helpers";
import type { Comparison } from "./use-comparison";
import { nameUnderUnit } from "@/lib/domain/cost-center-short-name";

const numCls = "px-3 py-1.5 text-right tabular-nums";

// A sheet with both sides totalled once. `impact` is how much of `own.result` comes from editorial changes.
type Row = { sheet: JoinedSheet; own: Totals; other: Totals; impact: number };
type Pair = { own: Totals; other: Totals; impact: number };

const add = (a: Totals, b: Totals): Totals => ({
  income: a.income + b.income,
  cost: a.cost + b.cost,
  result: a.result + b.result,
});

const sum = (rows: Row[]): Pair =>
  rows.reduce<Pair>(
    (a, r) => ({
      own: add(a.own, r.own),
      other: add(a.other, r.other),
      impact: a.impact + r.impact,
    }),
    { own: ZERO_TOTALS, other: ZERO_TOTALS, impact: 0 },
  );

export function Rambudget({
  comparison,
  ccIdOf,
  impactOf,
  showImpact,
  onPick,
}: {
  comparison: Comparison;
  ccIdOf: (key: string) => string | undefined;
  impactOf: (key: string) => number | undefined;
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
    // From lg the card is its own scrollport, sized to the window (see budget-client.tsx).
    // Below lg it flows with the page: a nested scroller on a phone is more trouble.
    <div className="rambudget budget-grid overflow-x-auto rounded-panel border border-border bg-background lg:max-h-full lg:overflow-y-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-xs text-muted">
            <th className="px-3 py-2 text-left font-medium">{tAlloc("costCenter")}</th>
            <th data-rule="l" className={cn("border-l border-border font-medium", numCls)}>
              {t("income")}
            </th>
            <th className={cn("font-medium", numCls)}>{t("costs")}</th>
            <th className={cn("font-medium", numCls)}>{t("result")}</th>

            {showImpact && (
              <th title={t("changesHint")} className={cn("font-medium", numCls)}>
                {t("changes")}
              </th>
            )}
            {showImpact && <th className={cn("font-medium", numCls)}>{t("original")}</th>}
            {showCompare && (
              <th data-rule="l" className={cn("border-l border-border font-medium", numCls)}>
                {comparison.otherLabel}
              </th>
            )}
            {showCompare && <th className={cn("font-medium", numCls)}>Diff</th>}
          </tr>
          <tr className="border-b-2 border-border bg-surface font-semibold">
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
                      id ? "cursor-pointer hover:bg-hover" : "text-muted",
                    )}
                    onClick={id ? () => onPick(id) : undefined}
                  >
                    <td
                      className="px-3 py-1.5"
                      title={row.sheet.shortName ? row.sheet.name : undefined}
                    >
                      {/^[@#]/.test(row.sheet.key) ? (
                        row.sheet.name
                      ) : (
                        <>
                          <span className="font-mono text-xs text-muted">{row.sheet.key}</span>{" "}
                          {nameUnderUnit(row.sheet)}
                        </>
                      )}

                      {!id && <span className="ml-2 text-xs">- {t("notInThisBudget")}</span>}
                    </td>
                    <Amounts
                      own={row.own}
                      other={row.other}
                      impact={row.impact}
                      showCompare={showCompare}
                      showImpact={showImpact}
                      soft
                    />
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

// The numeric tail of a row. `soft` picks the lighter divider. `data-rule="l"` marks cells
// with a left divider, which only matters in <thead> where pinned cells redraw their rules
// (see globals.css).
function Amounts({
  own,
  other,
  impact,
  showCompare,
  showImpact,
  soft,
}: {
  own: Totals;
  other: Totals;
  impact: number;
  showCompare: boolean;
  showImpact: boolean;
  soft?: boolean;
}) {
  const divider = soft ? "border-l border-border/50" : "border-l border-border";
  return (
    <>
      <td data-rule="l" className={cn(divider, numCls)}>
        {fmt(own.income)}
      </td>
      <td className={numCls}>{fmt(own.cost)}</td>
      <td className={cn(numCls, diffClass(own.result, true))}>{fmtSigned(own.result)}</td>

      {showImpact && (
        <td className={cn(numCls, impact !== 0 && diffClass(impact, true))}>
          {impact === 0 ? "" : fmtSigned(impact)}
        </td>
      )}
      {showImpact && (
        <td className={cn(numCls, "text-muted")}>
          {impact === 0 ? "" : fmtSigned(own.result - impact)}
        </td>
      )}
      {showCompare && (
        <td data-rule="l" className={cn(divider, numCls)}>
          {fmtSigned(other.result)}
        </td>
      )}
      {showCompare && (
        <td className={cn(numCls, diffClass(other.result - own.result, true))}>
          {fmtSigned(other.result - own.result)}
        </td>
      )}
    </>
  );
}

function FragmentGroup({
  resultUnit,
  own,
  other,
  impact,
  showCompare,
  showImpact,
  children,
}: {
  resultUnit: string;
  own: Totals;
  other: Totals;
  impact: number;
  showCompare: boolean;
  showImpact: boolean;
  children: React.ReactNode;
}) {
  const t = useTranslations("budget.rambudget");
  return (
    <>
      <tr className="border-b border-border bg-surface">
        <td
          className="px-3 py-1.5 text-xs font-medium text-muted"
          colSpan={4 + (showCompare ? 2 : 0) + (showImpact ? 2 : 0)}
        >
          {resultUnit}
        </td>
      </tr>
      {children}
      <tr className="border-b border-border text-sm font-medium">
        <td className="px-3 py-1.5 pl-6 text-muted">
          {t("groupTotal", { resultUnit: resultUnit.toLowerCase() })}
        </td>
        <Amounts
          own={own}
          other={other}
          impact={impact}
          showCompare={showCompare}
          showImpact={showImpact}
          soft
        />
      </tr>
    </>
  );
}
