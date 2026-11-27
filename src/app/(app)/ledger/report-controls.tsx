"use client";

// ReportParameters is what the report is *of* (one decision per row); ReportBar is what you do with the result
// (find a row, pick columns), pinned above the table.
import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import { Combobox, MultiCombobox, type ComboOption } from "@/components/ui/combobox";
import { Checkbox } from "@/components/ui/checkbox";
import { budgetLabel } from "@/lib/budget/compare";
import { SegmentedControl } from "@/components/ui/segmented-control";
import {
  PANEL_PILLS,
  PanelField,
  PanelRow,
  PeriodRow,
  type PeriodChoice,
} from "@/components/report-panel";
import type { BudgetOption, ComparisonMode, QueryState, ResultColumn } from "./report-types";
import { RESULT_COLUMNS } from "./report-types";

// The picker value for rows carrying no cost centre. The query spells that bucket "", which a picker cannot hold.
const CC_NONE = "__NONE__";

/** The cost centres as picker options, led by "no cost centre" and "any" (the query's own `*`, lib/ledger/cost-center-filter.ts). */
function costCenterOptions(
  costCenters: { code: string; name: string }[],
  noneLabel: string,
  anyLabel: string,
): ComboOption[] {
  return [
    { value: CC_NONE, label: noneLabel },
    { value: "*", label: anyLabel },
    ...costCenters.map((c, i) => ({
      value: c.code,
      label: `${c.code} - ${c.name}`,
      // The two buckets above are sides of the line; these are the cost centres themselves.
      dividerBefore: i === 0,
    })),
  ];
}

/** The period within the header's year, and the cost centres: what both panels ask first, as one component so they cannot diverge. */
function PeriodRows({
  query,
  onQuery,
  costCenters,
  period,
}: {
  query: QueryState;
  onQuery: (patch: Partial<QueryState>) => void;
  costCenters: { code: string; name: string }[];
  period?: PeriodChoice;
}) {
  const t = useTranslations("ledger");
  const tAlloc = useTranslations("allocation");
  const ccOptions = costCenterOptions(costCenters, t("noCostCenter"), t("withCostCenter"));

  return (
    <>
      <PeriodRow from={query.from} to={query.to} onRange={onQuery} period={period} />

      <PanelRow>
        <PanelField label={tAlloc("costCenter")} className="w-full sm:w-72">
          <MultiCombobox
            size="sm"
            options={ccOptions}
            values={query.costCenters.map((c) => c || CC_NONE)}
            onChange={(vs) => onQuery({ costCenters: vs.map((v) => (v === CC_NONE ? "" : v)) })}
            placeholder={t("allCostCenters")}
            searchPlaceholder={tAlloc("search")}
            emptyText={t("noCostCenters")}
            aria-label={tAlloc("costCenter")}
          />
        </PanelField>
      </PanelRow>
    </>
  );
}

/**
 * Which budget a comparison is against, for both panels. Every budget is offered, not only the report year's.
 * Hidden only when one budget exists and it is already the one compared against.
 */
function BudgetPicker({
  query,
  onQuery,
  budgets,
}: {
  query: QueryState;
  onQuery: (patch: Partial<QueryState>) => void;
  budgets: BudgetOption[];
}) {
  const t = useTranslations("ledger");
  if (budgets.length === 0 || (budgets.length === 1 && query.budget === budgets[0].id)) return null;
  return (
    <PanelField label={t("budget")} className="w-full sm:w-64">
      <Combobox
        size="sm"
        // Date (or year) first, then budgetLabel (shared with the compare pickers), so same-named budgets of
        // different years are told apart and typing "2024" narrows to that year.
        options={budgets.map((b) => ({ value: b.id, label: budgetLabel(b) }))}
        value={query.budget ?? ""}
        onChange={(v) => onQuery({ budget: v })}
        placeholder={t("budgetPlaceholder")}
        searchPlaceholder={t("budgetSearch")}
        emptyText={t("noBudgets")}
        aria-label={t("budgetAria")}
      />
    </PanelField>
  );
}

/** How fresh the figures are, at the foot of the parameters (a fact about the year being reported on). */
function SyncedNote({ synced }: { synced?: string | null }) {
  if (!synced) return null;
  return <p className="border-t border-divider px-inset py-2.5 text-xs text-muted">{synced}</p>;
}

export function ReportParameters({
  query,
  onQuery,
  columns,
  onColumns,
  diff,
  onDiff,
  costCenters,
  budgets,
  synced,
  period,
}: {
  query: QueryState;
  onQuery: (patch: Partial<QueryState>) => void;
  /** The result report's figure columns. See ResultColumn. */
  columns: readonly ResultColumn[];
  onColumns: (columns: ResultColumn[]) => void;
  /** The difference column beside the comparison. */
  diff: boolean;
  onDiff: (diff: boolean) => void;
  costCenters: { code: string; name: string }[];
  budgets: BudgetOption[];
  /** When the year was last synced from Fortnox, already worded. */
  synced?: string | null;
  /** The Period picker. See `period` in ledger-client.tsx. */
  period?: PeriodChoice;
}) {
  const t = useTranslations("ledger");

  return (
    <Card className="print:hidden">
      <PanelRow>
        <PanelField label={t("report")}>
          <SegmentedControl
            className={PANEL_PILLS}
            options={[
              { value: "RESULT", label: t("resultReport") },
              { value: "BALANCE", label: t("balanceReport") },
            ]}
            value={query.kind}
            onChange={(v) => onQuery({ kind: v })}
          />
        </PanelField>
      </PanelRow>

      <PeriodRows query={query} onQuery={onQuery} costCenters={costCenters} period={period} />

      {query.kind === "RESULT" && (
        <PanelRow>
          <PanelField label={t("columns")}>
            <div role="group" aria-label={t("columns")} className="flex flex-col gap-2 pt-0.5">
              {RESULT_COLUMNS.map((c) => {
                const label = t(`columnOption.${c}`);
                return (
                  <Checkbox
                    key={c}
                    label={label}
                    checked={columns.includes(c)}
                    // The last ticked box stays ticked: a report of no figures is not a report.
                    onChange={() => {
                      if (columns.includes(c) && columns.length === 1) return;
                      onColumns(
                        columns.includes(c) ? columns.filter((x) => x !== c) : [...columns, c],
                      );
                    }}
                  >
                    {label}
                  </Checkbox>
                );
              })}
            </div>
          </PanelField>
        </PanelRow>
      )}

      <PanelRow>
        <PanelField label={t("comparison")}>
          <SegmentedControl
            className={PANEL_PILLS}
            options={[
              { value: "NONE", label: t("none") },
              // The result report takes last year as its own columns (Kolumner), so only the budget is offered here.
              // The balance report has no such columns and keeps last year; its accounts aren't budgeted.
              ...(query.kind === "BALANCE"
                ? [{ value: "PRIOR", label: t("priorYear") }]
                : [{ value: "BUDGET", label: t("budget") }]),
            ]}
            value={query.compare}
            onChange={(v) => onQuery({ compare: v as ComparisonMode })}
          />
        </PanelField>
        {query.compare !== "NONE" && (
          <Checkbox
            label={t("difference")}
            checked={diff}
            onChange={() => onDiff(!diff)}
            className="self-end pb-2 lg:self-start lg:pb-0"
          >
            {t("difference")}
          </Checkbox>
        )}

        {query.compare === "BUDGET" && (
          <BudgetPicker query={query} onQuery={onQuery} budgets={budgets} />
        )}
      </PanelRow>
      <SyncedNote synced={synced} />
    </Card>
  );
}

/**
 * The parameters, as the charts need them: a card of its own, since most of the report's panel says nothing to a chart.
 * Left out: report kind (a balansrapport has nothing to draw, so the charts are not offered), grouping (the charts
 * break down per cost centre regardless; /api/ledger/trend never reads it) and prior year (only a budget gives the
 * pace line and ranking marks anything to draw). Writes the same `QueryState` as the report panel, as one period.
 */
export function ChartParameters({
  query,
  onQuery,
  costCenters,
  budgets,
  synced,
  period,
}: {
  query: QueryState;
  onQuery: (patch: Partial<QueryState>) => void;
  costCenters: { code: string; name: string }[];
  budgets: BudgetOption[];
  /** When the year was last synced from Fortnox, already worded. */
  synced?: string | null;
  /** The Period picker. See `period` in ledger-client.tsx. */
  period?: PeriodChoice;
}) {
  const t = useTranslations("ledger");
  const pacing = query.compare === "BUDGET";

  return (
    <Card className="print:hidden">
      <PeriodRows query={query} onQuery={onQuery} costCenters={costCenters} period={period} />

      <PanelRow>
        <PanelField label={t("charts.pacing")}>
          <SegmentedControl
            className={PANEL_PILLS}
            options={[
              { value: "NONE", label: t("none") },
              { value: "BUDGET", label: t("budget") },
            ]}
            value={pacing ? "BUDGET" : "NONE"}
            onChange={(v) => onQuery({ compare: v })}
          />
        </PanelField>

        {pacing && <BudgetPicker query={query} onQuery={onQuery} budgets={budgets} />}
      </PanelRow>
      <SyncedNote synced={synced} />
    </Card>
  );
}
