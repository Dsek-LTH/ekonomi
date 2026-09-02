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
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { Combobox, type ComboOption } from "@/components/ui/combobox";
import { budgetLabel } from "@/lib/budget/compare";
import { SearchInput } from "@/components/ui/search-input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import type { ReportKind } from "@/lib/ledger/bas";
import { cn } from "@/lib/ui/utils";
import type {
  BudgetOption,
  ComparisonMode,
  GroupMode,
  QueryState,
  ViewOptions,
} from "./report-types";

// The two picker values that aren't a cost centre: all of them, and the rows
// carrying none.
const CC_ALL = "__ALL__";
const CC_NONE = "__NONE__";

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
function Row({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end gap-x-6 gap-y-3 border-t border-border px-inset py-3.5 first:border-t-0">
      {children}
    </div>
  );
}

export function ReportParameters({
  query,
  onQuery,
  years,
  months,
  costCenters,
  budgets,
}: {
  query: QueryState;
  onQuery: (patch: Partial<QueryState>) => void;
  years: { id: number; year: number }[];
  months: ComboOption[];
  costCenters: { code: string; name: string }[];
  budgets: BudgetOption[];
}) {
  const t = useTranslations("ledger");
  const tAlloc = useTranslations("allocation");
  const yearOptions: ComboOption[] = years.map((y) => ({
    value: String(y.id),
    label: String(y.year),
  }));
  const ccOptions: ComboOption[] = [
    { value: CC_ALL, label: t("allCostCenters") },
    { value: CC_NONE, label: t("noCostCenter") },
    ...costCenters.map((c) => ({ value: c.code, label: `${c.code} – ${c.name}` })),
  ];

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
        <Field label={t("from")} className="min-w-36 flex-1 sm:w-44 sm:flex-none">
          <Combobox
            size="sm"
            options={months}
            value={query.from ?? ""}
            onChange={(v) => onQuery({ from: v })}
            placeholder={t("monthPlaceholder")}
            searchPlaceholder={t("monthSearch")}
            aria-label={t("fromMonth")}
          />
        </Field>
        <Field label={t("to")} className="min-w-36 flex-1 sm:w-44 sm:flex-none">
          <Combobox
            size="sm"
            options={months}
            value={query.to ?? ""}
            onChange={(v) => onQuery({ to: v })}
            placeholder={t("monthPlaceholder")}
            searchPlaceholder={t("monthSearch")}
            aria-label={t("toMonth")}
          />
        </Field>
      </Row>

      <Row>
        <Field label={tAlloc("costCenter")} className="w-full sm:w-72">
          <Combobox
            size="sm"
            options={ccOptions}
            value={query.costCenter == null ? CC_ALL : query.costCenter || CC_NONE}
            onChange={(v) =>
              onQuery({ costCenter: v === CC_ALL ? null : v === CC_NONE ? "" : v })
            }
            placeholder={t("allCostCenters")}
            searchPlaceholder={tAlloc("search")}
            emptyText={t("noCostCenters")}
            aria-label={tAlloc("costCenter")}
          />
        </Field>
      </Row>

      <Row>
        <Field label={t("grouping")}>
          <SegmentedControl
            className={PILLS}
            options={[
              { value: "SUMMED", label: t("summed") },
              { value: "SPECIFIED", label: t("perCostCenter") },
            ]}
            value={query.group}
            onChange={(v) => onQuery({ group: v as GroupMode })}
          />
        </Field>
      </Row>

      <Row>
        <Field label={t("comparison")}>
          <SegmentedControl
            className={PILLS}
            options={[
              { value: "NONE", label: t("none") },
              { value: "PRIOR", label: t("priorYear") },
              // Balance-sheet accounts aren't budgeted, so the option isn't
              // offered there rather than offered and then dropped.
              ...(query.kind === "BALANCE" ? [] : [{ value: "BUDGET", label: t("budget") }]),
            ]}
            value={query.compare}
            onChange={(v) => onQuery({ compare: v as ComparisonMode })}
          />
        </Field>

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
    </Card>
  );
}

export function ReportBar({
  view,
  onView,
  showComparison,
  summary,
  showSummary,
  onEditParameters,
  count,
  action,
  views,
  charting,
}: {
  view: ViewOptions;
  onView: (patch: Partial<ViewOptions>) => void;
  /** Whether a comparison column is on show. The diff toggle needs one. */
  showComparison: boolean;
  /** What the report is of, shown here once the panel is off screen. */
  summary: string;
  showSummary: boolean;
  onEditParameters: () => void;
  count: React.ReactNode;
  /**
   * What you can do with the report: export it, print it.
   *
   * Here rather than in the page header, which says what you are looking at and
   * not what you can do to it (components/page-shell.tsx). It also means the
   * two are absent until there is a report to act on, instead of sitting at the
   * top of the page greyed out, which is the rule the chips above already
   * follow.
   */
  action?: React.ReactNode;
  /**
   * Table or charts, as a ViewToggle. Its own slot rather than part of
   * `action`: those are things you do *to* the report (export it, print it) and
   * this changes how it is drawn, which the app tells apart by shape. See
   * components/ui/segmented-control.tsx for the grammar of the four switchers.
   */
  views?: React.ReactNode;
  /**
   * Whether the charts are what is on screen.
   *
   * Everything on the left of this bar narrows *rows*: a search over account
   * names, a chip that drops the empty ones, a column of shares. None of it
   * means anything to a chart of the same period, and a control that is present
   * and inert is worse than one that is absent.
   */
  charting?: boolean;
}) {
  const t = useTranslations("ledger");
  return (
    <div
      className={cn(
        // Pinned to the top of the scroll container: below md that is the page,
        // under the 3.5rem mobile header; from md the main column.
        "sticky top-14 z-10 -mx-4 border-b border-border px-4 py-2.5",
        // Opaque on a phone: a translucent, blurred layer pinned over content
        // that is scrolling under it is repainted every frame, and that is felt
        // on a phone in a way it never is on a laptop.
        "bg-canvas md:bg-canvas/90 md:backdrop-blur",
        "md:top-0 md:-mx-8 md:px-8",
        "print:hidden",
      )}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {!charting && (
          <>
            <SearchInput
              id="report-search"
              className="w-full sm:w-64"
              value={view.query}
              onChange={(e) => onView({ query: e.target.value })}
              placeholder={t("accountSearch")}
              aria-label={t("accountSearch")}
            />
            <Chip active={view.hideZero} onClick={() => onView({ hideZero: !view.hideZero })}>
              {t("hideZeroRows")}
            </Chip>
            <Chip active={view.share} onClick={() => onView({ share: !view.share })}>
              {t("shareOfTotal")}
            </Chip>
            {/* Nothing to take a difference against without a comparison, so the
                toggle is absent rather than present and inert. */}
            {showComparison && (
              <Chip active={view.diff} onClick={() => onView({ diff: !view.diff })}>
                {t("difference")}
              </Chip>
            )}
          </>
        )}

        {/* Only once the panel has scrolled away. While it's on screen it
            already says all this, in full. Truncates rather than wraps: the
            bar's height is what the table headers stick beneath, so it has to
            stay one line however long the summary gets. */}
        {showSummary && (
          <>
            <span className="ml-auto hidden min-w-0 flex-1 truncate text-right text-sm text-muted lg:block">
              {summary}
            </span>
            <Button variant="secondary" size="sm" onClick={onEditParameters}>
              {t("change")}
            </Button>
          </>
        )}

        <div className="ml-auto shrink-0 whitespace-nowrap text-sm text-muted">
          {charting ? null : count}
        </div>

        {views}
        {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
      </div>
    </div>
  );
}
