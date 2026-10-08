"use client";

// The report's controls, in two pieces that answer two different questions.
//
// ReportParameters is what the report is *of*, asked one thing per row in the
// order you'd ask them out loud: which report, over what time, for which cost
// centre, grouped how, compared against what. Each row is a band of its own, so
// the panel reads downwards as a list of decisions rather than sideways as a
// wall of pickers.
//
// ReportBar is what you do *with* the result once it's on screen: find a row,
// change which columns show, so it lives with the table, stays pinned to the
// top while you scroll, and takes over showing what the report is of once the
// panel above has scrolled out of sight.
import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import { Combobox, MultiCombobox, type ComboOption } from "@/components/ui/combobox";
import { DateInput } from "@/components/ui/field";
import { Checkbox } from "@/components/ui/checkbox";
import { useState } from "react";
import { budgetLabel } from "@/lib/budget/compare";
import { SegmentedControl } from "@/components/ui/segmented-control";
import type { ReportKind } from "@/lib/ledger/bas";
import { cn } from "@/lib/ui/utils";
import type {
  BudgetOption,
  ComparisonMode,
  QueryState,
  ResultColumn,
} from "./report-types";
import { RESULT_COLUMNS } from "./report-types";

// The picker value for the rows carrying no cost centre. The query spells that
// bucket "", which a picker cannot hold as a value, since it reads as empty.
// "Every cost centre" is not an option at all any more: it is picking none,
// which the trigger shows as its placeholder and the clear button returns to.
const CC_NONE = "__NONE__";

/**
 * The cost centres as picker options, led by the two that are not one cost
 * centre but a side of the line: rows carrying none, and rows carrying any.
 * "Med kostnadsställe" is the query's own `*` (see lib/ledger/cost-center-
 * filter.ts), which a picker can hold as it is.
 */
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
      label: `${c.code} – ${c.name}`,
      // The two buckets above are sides of the line; these are the cost
      // centres themselves, and the rule says the list changes kind here.
      dividerBefore: i === 0,
    })),
  ];
}

// One decision, labelled. The label is what makes a control readable on its
// own. Five bare pickers in a row all look like the same filter.
// A <span>, not a <label>: every control below is a button or a listbox that
// carries its own aria-label, and a <label> with nothing to point at is an
// empty promise to a screen reader.
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
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted">
        {label}
      </span>
      {children}
    </div>
  );
}

// The pills are shorter than a Combobox trigger (h-9, see components/ui/field
// .tsx), and a row that mixes the two heights reads as misaligned however it is
// aligned. Every control in the panel is therefore field-height.
const PILLS = "[&>button]:h-11 sm:[&>button]:h-9";

// One row of the panel. Hairline above, none on the first. The rows are the
// structure, so they get the rule rather than the whole panel getting padding.
//
// From lg the panel is a column to the left of the report (see ledger-client),
// too narrow for fields side by side, so each row stacks its fields and every
// one takes the column's width.
function Row({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end gap-x-6 gap-y-3 border-t border-border px-inset py-3.5 first:border-t-0 lg:flex-col lg:flex-nowrap lg:items-stretch lg:[&>*]:w-full">
      {children}
    </div>
  );
}

export interface PeriodChoice {
  options: ComboOption[];
  value: string;
  onPick: (value: string) => void;
  /** A date was typed or picked by hand: the range is the reader's own now. */
  onManual: () => void;
}

/**
 * One end of the period, as a date typed or picked.
 *
 * What is typed is held here and only handed on once it is a whole date that
 * exists: the report refetches on every change to the query, and it is the
 * slowest request in the app, so "2026-0" on the way to "2026-03-15" must not
 * be one. Left half-typed, it goes back to the date the report is actually
 * showing. The server clamps the period into the financial year and reports
 * back what it used, which arrives here as a new `value`.
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
  // When the report answers with a different date (clamped into the year, or
  // a new year picked), the field follows it. Adjusted during render rather
  // than in an effect, so there is no frame showing the stale one.
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

/**
 * How fresh the figures are, at the foot of the parameters. It used to trail
 * the page's description under the title, where it read as part of a sentence
 * about what the page is. It is a fact about the year being reported on, which
 * is what the panel above it chooses, so it sits with that.
 */
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
  years,
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
  years: { id: number; year: number }[];
  costCenters: { code: string; name: string }[];
  budgets: BudgetOption[];
  /** When the year was last synced from Fortnox, already worded. */
  synced?: string | null;
  /** The Period picker. See `period` in ledger-client.tsx. */
  period?: PeriodChoice;
}) {
  const t = useTranslations("ledger");
  const tAlloc = useTranslations("allocation");
  const yearOptions: ComboOption[] = years.map((y) => ({
    value: String(y.id),
    label: String(y.year),
  }));
  const ccOptions = costCenterOptions(costCenters, t("noCostCenter"), t("withCostCenter"));

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
            onChange={(v) => onQuery({ kind: v as ReportKind })}
          />
        </Field>
      </Row>

      <Row>
        <Field label={t("year")} className="w-28">
          <Combobox
            size="sm"
            options={yearOptions}
            value={query.year != null ? String(query.year) : ""}
            onChange={(v) => onQuery({ year: Number(v) })}
            placeholder={t("yearPlaceholder")}
            searchPlaceholder={t("yearSearch")}
            emptyText={t("noYears")}
            aria-label={t("year")}
          />
        </Field>
        {/* Above the dates it names. A preset sets them; typing in them makes
            the range the reader's own, and the picker says so. */}
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
        {/* From and To as one range, side by side with a dash between, at
            every width, including the panel's narrow column from lg, where every
            other field takes a row of its own. Dates, not months: a report can
            be taken over any span of days, the way Fortnox takes one. */}
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
        {/* The height of a control, so the dash sits level with the two. */}
        <span aria-hidden className="flex h-11 items-center text-muted sm:h-9">
          –
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

      {/* Which figures stand beside each account. Result report only: the
          balance report's columns are fixed (opening, period, closing). */}
      {query.kind === "RESULT" && (
        <Row>
          <Field label={t("columns")}>
            {/* Plain boxes, every option in sight: five is few enough to read
                at a glance, and a dropdown hid which ones were on behind a
                "3 valda". */}
            <div role="group" aria-label={t("columns")} className="flex flex-col gap-2 pt-0.5">
              {RESULT_COLUMNS.map((c) => {
                const label = t(`columnOption.${c}`);
                return (
                  <Checkbox
                    key={c}
                    label={label}
                    checked={columns.includes(c)}
                    // The last ticked box stays ticked: a report of no figures
                    // is not a report, and a table that quietly showed the
                    // period anyway would disagree with the boxes above it.
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
              // The result report takes last year as columns of its own (see
              // Kolumner above), so here it is only the budget. The balance
              // report has no such columns and keeps last year here. Balance
              // accounts aren't budgeted, so the budget isn't offered there.
              ...(query.kind === "BALANCE"
                ? [{ value: "PRIOR", label: t("priorYear") }]
                : [{ value: "BUDGET", label: t("budget") }]),
            ]}
            value={query.compare}
            onChange={(v) => onQuery({ compare: v as ComparisonMode })}
          />
        </Field>
        {/* With the comparison it is the difference against, and only while
            there is one: a toggle with nothing to take a difference of would
            be present and inert. */}
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

        {/* Which budget you mean is part of choosing "budget", so it sits in
            the same row. Every budget is offered, not only the ones for the year
            being reported on. Holding this year's outcome against what was
            budgeted two years ago is a fair question to ask.

            Hidden only when there is nothing to choose: one budget, and it is
            already the one being compared against. A lone budget belonging to
            some other year is not that case. It is the one you would have to
            reach for by hand. */}
        {query.compare === "BUDGET"
          && (budgets.length > 1 || (budgets.length === 1 && query.budget !== budgets[0].id)) && (
          <Field label={t("budget")} className="w-full sm:w-64">
            <Combobox
            size="sm"
              // Date (or year) first, then the budget's own name, budgetLabel,
              // the same one the compare pickers use, because three screens
              // spelling a budget three ways is three things to keep in step.
              // Leading with the date is what tells two years' "Ursprunglig"
              // apart and what makes picking one from another year a deliberate
              // act rather than a slip; typing "2024" narrows to that year,
              // since the search reads the label.
              options={budgets.map((b) => ({ value: b.id, label: budgetLabel(b) }))}
              value={query.budget ?? ""}
              onChange={(v) => onQuery({ budget: v })}
              placeholder={t("budgetPlaceholder")}
              searchPlaceholder={t("budgetSearch")}
              emptyText={t("noBudgets")}
              aria-label={t("budgetAria")}
            />
          </Field>
        )}
      </Row>
      <SyncedNote synced={synced} />
    </Card>
  );
}

/**
 * The parameters, as the charts need them.
 *
 * A card of its own rather than the report's, because most of the report's
 * panel says nothing to a chart and a control that is present and inert is
 * worse than one that is absent. What is left out, and why:
 *
 *   report kind    A balansrapport is a position rather than a period, so there
 *                    is nothing here to draw and the switch to these charts is
 *                    not offered for one. Everything on this card is therefore
 *                    about a result report already.
 *   grouping       Summed or per cost centre is how the *table* stacks its
 *                    rows, and it follows from the cost-centre filter rather
 *                    than being chosen. /api/ledger/trend never reads it: the charts break
 *                    the period down per cost centre whatever it says, because
 *                    that is what two of the five are about.
 *   prior year     The one comparison these charts do not draw. Only a budget
 *                    gives them anything, the pace line on the cumulative
 *                    chart and the marks on the ranking, so the three-way
 *                    choice becomes the one question that has an answer here.
 *
 * What it writes is the same `QueryState` the report panel writes, deliberately.
 * The two views describe one period, and a second copy of the year and the
 * period would be two things to keep in step and a screen that changed its mind
 * about what it was showing when you switched.
 */
export function ChartParameters({
  query,
  onQuery,
  years,
  costCenters,
  budgets,
  synced,
  period,
}: {
  query: QueryState;
  onQuery: (patch: Partial<QueryState>) => void;
  years: { id: number; year: number }[];
  costCenters: { code: string; name: string }[];
  budgets: BudgetOption[];
  /** When the year was last synced from Fortnox, already worded. */
  synced?: string | null;
  /** The Period picker. See `period` in ledger-client.tsx. */
  period?: PeriodChoice;
}) {
  const t = useTranslations("ledger");
  const tAlloc = useTranslations("allocation");
  const yearOptions: ComboOption[] = years.map((y) => ({
    value: String(y.id),
    label: String(y.year),
  }));
  const ccOptions = costCenterOptions(costCenters, t("noCostCenter"), t("withCostCenter"));
  const pacing = query.compare === "BUDGET";

  return (
    <Card className="print:hidden">
      <Row>
        <Field label={t("year")} className="w-28">
          <Combobox
            size="sm"
            options={yearOptions}
            value={query.year != null ? String(query.year) : ""}
            onChange={(v) => onQuery({ year: Number(v) })}
            placeholder={t("yearPlaceholder")}
            searchPlaceholder={t("yearSearch")}
            emptyText={t("noYears")}
            aria-label={t("year")}
          />
        </Field>
        {/* Above the dates it names. A preset sets them; typing in them makes
            the range the reader's own, and the picker says so. */}
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
        {/* From and To as one range, side by side with a dash between, at
            every width, including the panel's narrow column from lg, where every
            other field takes a row of its own. Dates, not months: a report can
            be taken over any span of days, the way Fortnox takes one. */}
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
        {/* The height of a control, so the dash sits level with the two. */}
        <span aria-hidden className="flex h-11 items-center text-muted sm:h-9">
          –
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

      <Row>
        {/* Two answers where the report offers three, because a budget is the
            only comparison these charts have anywhere to put. It is the same
            setting the report's comparison holds, so turning it on here does
            replace a prior-year column over there. That is not a side effect to
            hide: it is one report, and you have just changed what it is
            compared against. */}
        <Field label={t("charts.pacing")}>
          <SegmentedControl
            className={PILLS}
            options={[
              { value: "NONE", label: t("none") },
              { value: "BUDGET", label: t("budget") },
            ]}
            value={pacing ? "BUDGET" : "NONE"}
            onChange={(v) => onQuery({ compare: v as ComparisonMode })}
          />
        </Field>

        {/* The same rule the report panel applies: offered unless there is
            nothing to choose, meaning one budget that is already the one in
            use. See the note there. */}
        {pacing
          && (budgets.length > 1 || (budgets.length === 1 && query.budget !== budgets[0].id)) && (
          <Field label={t("budget")} className="w-full sm:w-64">
            <Combobox
              size="sm"
              options={budgets.map((b) => ({ value: b.id, label: budgetLabel(b) }))}
              value={query.budget ?? ""}
              onChange={(v) => onQuery({ budget: v })}
              placeholder={t("budgetPlaceholder")}
              searchPlaceholder={t("budgetSearch")}
              emptyText={t("noBudgets")}
              aria-label={t("budgetAria")}
            />
          </Field>
        )}
      </Row>
      <SyncedNote synced={synced} />
    </Card>
  );
}
