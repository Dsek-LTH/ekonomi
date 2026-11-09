"use client";

// ReportParameters is what the report is *of* (one decision per row); ReportBar is what you do with the result
// (find a row, pick columns), pinned above the table.
import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import { Combobox, MultiCombobox, type ComboOption } from "@/components/ui/combobox";
import { DateInput } from "@/components/ui/field";
import { Checkbox } from "@/components/ui/checkbox";
import { useState } from "react";
import { budgetLabel } from "@/lib/budget/compare";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { cn } from "@/lib/ui/utils";
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

// One decision, labelled. A <span>, not a <label>: every control below carries its own aria-label.
function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <span className="text-xs font-medium text-muted">{label}</span>
      {children}
    </div>
  );
}

// Pills are shorter than a Combobox trigger (h-8, components/ui/field.tsx), so every control in the panel is field-height.
const PILLS = "[&>button]:h-11 sm:[&>button]:h-8";

// One row of the panel, hairline above except the first. From lg the panel is a narrow column left of the report, so fields stack.
function Row({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end gap-x-6 gap-y-3 border-t border-border px-inset py-3.5 first:border-t-0 lg:flex-col lg:flex-nowrap lg:items-stretch lg:[&>*]:w-full">
      {children}
    </div>
  );
}

interface PeriodChoice {
  options: ComboOption[];
  value: string;
  onPick: (value: string) => void;
  /** A date was typed or picked by hand: the range is the reader's own now. */
  onManual: () => void;
}

/**
 * One end of the period, as a date typed or picked. Typed text is only handed on once it is a whole, existing date:
 * the report refetches on every query change and is the slowest request. Half-typed reverts to the date shown.
 * The server clamps the period into the financial year and reports back what it used, arriving as a new `value`.
 */
function PeriodDate({
  value,
  onCommit,
  "aria-label": ariaLabel,
}: {
  value: string | null;
  onCommit: (date: string) => void;
  "aria-label": string;
}) {
  const [draft, setDraft] = useState(value ?? "");
  // When the report answers with a different date (clamped, or a new year), the field follows; adjusted during render to avoid a stale frame.
  const [shown, setShown] = useState(value);
  if (value !== shown) {
    setShown(value);
    setDraft(value ?? "");
  }
  const isDate = (s: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(`${s}T00:00:00Z`).getTime());

  return (
    <DateInput
      size="sm"
      value={draft}
      aria-label={ariaLabel}
      onChange={(e) => {
        const next = e.target.value;
        setDraft(next);
        if (isDate(next) && next !== value) onCommit(next);
      }}
      onBlur={() => {
        if (!isDate(draft)) setDraft(value ?? "");
      }}
    />
  );
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
      <Row>
        {period && (
          <Field label={t("period")} className="w-full sm:w-56">
            <Combobox
              size="sm"
              options={period.options}
              value={period.value}
              onChange={period.onPick}
              searchPlaceholder={t("periodSearch")}
              aria-label={t("period")}
            />
          </Field>
        )}
        <div className="flex min-w-0 items-end gap-2">
          <Field label={t("from")} className="min-w-0 flex-1 sm:w-40 sm:flex-none lg:flex-1">
            <PeriodDate
              value={query.from}
              onCommit={(v) => {
                period?.onManual();
                onQuery({ from: v });
              }}
              aria-label={t("from")}
            />
          </Field>
          <span aria-hidden className="flex h-11 items-center text-muted sm:h-8">
            -
          </span>
          <Field label={t("to")} className="min-w-0 flex-1 sm:w-40 sm:flex-none lg:flex-1">
            <PeriodDate
              value={query.to}
              onCommit={(v) => {
                period?.onManual();
                onQuery({ to: v });
              }}
              aria-label={t("to")}
            />
          </Field>
        </div>
      </Row>

      <Row>
        <Field label={tAlloc("costCenter")} className="w-full sm:w-72">
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
        </Field>
      </Row>
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
    <Field label={t("budget")} className="w-full sm:w-64">
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
    </Field>
  );
}

/** How fresh the figures are, at the foot of the parameters (a fact about the year being reported on). */
function SyncedNote({ synced }: { synced?: string | null }) {
  if (!synced) return null;
  return <p className="border-t border-border px-inset py-2.5 text-xs text-muted">{synced}</p>;
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
      <Row>
        <Field label={t("report")}>
          <SegmentedControl
            className={PILLS}
            options={[
              { value: "RESULT", label: t("resultReport") },
              { value: "BALANCE", label: t("balanceReport") },
            ]}
            value={query.kind}
            onChange={(v) => onQuery({ kind: v })}
          />
        </Field>
      </Row>

      <PeriodRows query={query} onQuery={onQuery} costCenters={costCenters} period={period} />

      {query.kind === "RESULT" && (
        <Row>
          <Field label={t("columns")}>
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
          </Field>
        </Row>
      )}

      <Row>
        <Field label={t("comparison")}>
          <SegmentedControl
            className={PILLS}
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
        </Field>
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
      </Row>
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

      <Row>
        <Field label={t("charts.pacing")}>
          <SegmentedControl
            className={PILLS}
            options={[
              { value: "NONE", label: t("none") },
              { value: "BUDGET", label: t("budget") },
            ]}
            value={pacing ? "BUDGET" : "NONE"}
            onChange={(v) => onQuery({ compare: v })}
          />
        </Field>

        {pacing && <BudgetPicker query={query} onQuery={onQuery} budgets={budgets} />}
      </Row>
      <SyncedNote synced={synced} />
    </Card>
  );
}
