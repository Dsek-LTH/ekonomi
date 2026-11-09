"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { PageShell } from "@/components/page-shell";
import { useNotify } from "@/components/shell/notifications";
import { resolveApiError } from "@/lib/ui/api-error";
import { useFillViewport } from "@/lib/ui/use-fill-viewport";
import { useQuery } from "@/components/shell/use-query";
import { Menu, MenuItem } from "@/components/ui/menu";
import { IconChart, IconDownload, IconViewTable } from "@/components/ui/icons";
import { EmptyNote, EmptyState } from "@/components/ui/empty-state";
import { ViewToggle } from "@/components/ui/view-toggle";
import { SkeletonSheet } from "@/components/ui/skeleton";
import { type ComboOption } from "@/components/ui/combobox";

import type { FortnoxStatus } from "@/lib/domain/types";
import { ChartParameters, ReportParameters } from "./report-controls";
import {
  ReportGroupCard,
  ReportResult,
  ReportScroller,
  ReportSkeleton,
  reportColumns,
  reportSurfaceVars,
  type Shape,
} from "./report-table";
import { ReportCharts, type TrendResponse } from "./report-charts";
import { ReportPrint } from "./report-print";
import { downloadCsv, reportToCsv } from "./report-view";
import { useFormat } from "@/lib/ui/use-format";
import { cn } from "@/lib/ui/utils";
import {
  EMPTY_VIEW,
  type LedgerYear,
  needsPriorYear,
  type QueryState,
  type ResultColumn,
  type ReportAccount,
  type ReportGroup,
  type ReportResponse,
  type RowView,
  type ViewOptions,
} from "./report-types";
import { isoDay } from "@/lib/domain/date";

// Month names come from the locale (Intl). Two lengths: pickers/readouts have room for "September", an x axis does not.
const monthName = (locale: string, monthIndex: number, long = true) =>
  new Date(Date.UTC(2000, monthIndex, 1)).toLocaleString(locale, {
    month: long ? "long" : "short",
    timeZone: "UTC",
  });

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Every month the financial year spans, as the days it covers (a broken year's first and last are clipped). */
function monthsOf(
  year: LedgerYear,
): { key: string; from: string; to: string; index: number; y: number }[] {
  const out: { key: string; from: string; to: string; index: number; y: number }[] = [];
  const start = new Date(`${year.fromDate}T00:00:00Z`);
  const end = new Date(`${year.toDate}T00:00:00Z`);
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  while (cursor <= end) {
    const y = cursor.getUTCFullYear();
    const m = cursor.getUTCMonth();
    const first = isoDay(cursor);
    const last = isoDay(new Date(Date.UTC(y, m + 1, 0)));
    out.push({
      key: `${y}-${String(m + 1).padStart(2, "0")}`,
      from: first < year.fromDate ? year.fromDate : first,
      to: last > year.toDate ? year.toDate : last,
      index: m,
      y,
    });
    cursor.setUTCMonth(m + 1);
  }
  return out;
}

const WHOLE_YEAR = "YEAR";
const CUSTOM = "CUSTOM";

const INITIAL: QueryState = {
  kind: "RESULT",
  year: null,
  from: null,
  to: null,
  costCenters: [],
  group: "SUMMED",
  compare: "NONE",
  budget: null,
  prior: false,
};

export default function LedgerClient({
  fortnox,
  costCenters,
  fiscalYearId,
}: {
  fortnox: FortnoxStatus;
  costCenters: { code: string; name: string }[];
  /** The header's räkenskapsår. Changing it remounts this (page.tsx keys it by the year). Null before any year is synced. */
  fiscalYearId: number | null;
}) {
  const t = useTranslations("ledger");
  const tCommon = useTranslations("common");
  // Un-namespaced, for resolveApiError: server codes are absolute paths under `errors`.
  const tAll = useTranslations();
  const notify = useNotify();
  const { date, dateTime } = useFormat();
  const locale = useLocale();
  // Chart month labels: short and yearless on the axis, full in a readout.
  const chartMonthLabel = useCallback(
    (m: string, long = false) => {
      const [y, mm] = m.split("-");
      const name = capitalize(monthName(locale, Number(mm) - 1, long));
      return long ? `${name} ${y}` : name;
    },
    [locale],
  );

  const [data, setData] = useState<ReportResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // State, so it is the same object for the life of the page (the year's, see fiscalYearId).
  const [initial] = useState<QueryState>(() => ({ ...INITIAL, year: fiscalYearId }));
  const [query, setQuery] = useState<QueryState>(initial);
  const [view, setView] = useState<ViewOptions>(EMPTY_VIEW);

  /** Table or charts over the same report. The charts are their own fetch, made the first time somebody switches. */
  const [mode, setMode] = useState<"TABLE" | "CHART">("TABLE");

  const [openKey, setOpenKey] = useState<string | null>(null);
  const [rows, setRows] = useState<Record<string, RowView[]>>({});
  /**
   * Which report the cached rows belong to. Bumped by `update` (which empties the cache) so a drill-down in flight
   * when a filter changed cannot refill the cache with last period's transactions.
   */
  const reportGeneration = useRef(0);

  // Only the newest request may write to state, so a slow early one cannot overwrite a later one.
  const latest = useRef(0);

  // Whether the dates were last set by hand, so a hand-typed whole month does not snap back to naming that month.
  // Cleared by picking a preset or another year.
  const [customPeriod, setCustomPeriod] = useState(false);
  // Their own state: "Rensa" clears the search and zero filter, not the column choice.
  const [columns, setColumns] = useState<ResultColumn[]>(["period"]);

  // The panel and report are sized to the window from lg so only the accounts scroll (useFillViewport).
  const fillRef = useFillViewport<HTMLDivElement>();

  /**
   * The report itself: the one fetch here that is not a `useQuery`. The server clamps the period and picks defaults and
   * the controls follow what it reported, so deriving the url from `query` would make that write-back a second request.
   */
  const load = useCallback(
    async (q: QueryState) => {
      const id = ++latest.current;
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          kind: q.kind,
          group: q.group,
          compare: q.compare,
        });
        if (q.year != null) params.set("year", String(q.year));
        if (q.from) params.set("from", q.from);
        if (q.to) params.set("to", q.to);
        // Absent means every cost centre; an empty one means the rows carrying none.
        for (const cc of q.costCenters) params.append("costCenter", cc);
        if (q.budget) params.set("budget", q.budget);
        if (q.prior) params.set("prior", "1");
        const res = await fetch(`/api/ledger/report?${params.toString()}`);
        const json = await res.json();
        if (id !== latest.current) return;
        // Through resolveApiError: `json.error` is a message code ("auth.signedOut"), not text.
        if (!res.ok) throw new Error(resolveApiError(tAll, json) ?? t("loadFailed"));
        setData(json);
        // The server clamps the period and picks a default, so the controls follow what it reported on.
        setQuery((cur) => ({
          ...cur,
          year: json.year?.id ?? null,
          from: json.period?.from ?? null,
          to: json.period?.to ?? null,
          // The server resolves which budget was used (the locked one unless asked otherwise).
          budget: json.budget ?? null,
        }));
      } catch (e) {
        if (id !== latest.current) return;
        setError(e instanceof Error ? e.message : tCommon("error.network"));
      } finally {
        if (id === latest.current) setLoading(false);
      }
    },
    [t, tAll, tCommon],
  );

  /**
   * The same period, cut for the charts (/api/ledger/trend). Declarative: the url is the state, fetched when the charts
   * are on screen and refetched when their parameters move. Null while the table shows or for a balansrapport.
   */
  const trendUrl = useMemo(() => {
    if (mode !== "CHART" || query.kind !== "RESULT" || query.year == null) return null;
    const params = new URLSearchParams({ year: String(query.year), compare: query.compare });
    if (query.from) params.set("from", query.from);
    if (query.to) params.set("to", query.to);
    for (const cc of query.costCenters) params.append("costCenter", cc);
    if (query.budget) params.set("budget", query.budget);
    return `/api/ledger/trend?${params.toString()}`;
  }, [mode, query]);

  const {
    data: trend,
    loading: trendLoading,
    error: trendError,
  } = useQuery<TrendResponse>(trendUrl, { error: "ledger.loadFailed", keepPrevious: false });

  // load() sets `loading`/`error` to what they already are on this first call, so React bails out; the rule cannot see that.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load(initial);
  }, [load, initial]);

  const hasPanel = data != null && data.years.length > 0;

  // Anything the server decides refetches; the view options below don't.
  function update(patch: Partial<QueryState>) {
    setOpenKey(null);
    setRows({});
    reportGeneration.current++;
    // Nothing to drop for the charts: their url is built from `query`.
    const next = { ...query, ...patch };
    // Summed or per cost centre follows from the cost centres asked for: all is one summed report, any means one card each.
    next.group = next.costCenters.length > 0 ? "SPECIFIED" : "SUMMED";
    // A new year has its own months, so the period resets. The budget does not: a hand-picked one is kept, null lets the
    // server offer this year's.
    if (patch.year !== undefined && patch.year !== query.year) {
      next.from = null;
      next.to = null;
      setCustomPeriod(false);
    }
    // A balansrapport has nothing the charts draw: put a viewer in the charts back in the table.
    if (next.kind !== "RESULT") setMode("TABLE");
    // The result report takes last year as columns, not as its comparison: "Föregående år" becomes the column.
    if (next.kind === "RESULT" && next.compare === "PRIOR") {
      next.compare = "NONE";
      const withPrior: ResultColumn[] = columns.includes("prior") ? columns : [...columns, "prior"];
      setColumns(withPrior);
      next.prior = true;
    }
    setQuery(next);
    load(next);
  }

  // A column change goes back to the server only when it changes whether last year is needed.
  function changeColumns(next: ResultColumn[]) {
    setColumns(next);
    const prior = needsPriorYear(next);
    if (prior !== query.prior) update({ prior });
  }

  async function toggleRow(g: ReportGroup, acct: ReportAccount) {
    const key = `${g.costCenterCode ?? ""}|${acct.account}`;
    if (openKey === key) {
      setOpenKey(null);
      return;
    }
    setOpenKey(key);
    if (!rows[key] && query.year != null) {
      const generation = reportGeneration.current;
      const params = new URLSearchParams({
        year: String(query.year),
        account: acct.account,
      });
      // Per cost centre, the row is that cost centre; summed, every cost centre the report was filtered to.
      if (query.group === "SPECIFIED") params.set("costCenter", g.costCenterCode ?? "");
      else for (const cc of query.costCenters) params.append("costCenter", cc);
      if (query.from) params.set("from", query.from);
      if (query.to) params.set("to", query.to);
      // Say a failed drill-down failed (not "nothing behind this account"); the row stays open for a retry.
      try {
        const res = await fetch(`/api/ledger/rows?${params.toString()}`);
        const json = await res.json().catch(() => ({}));
        // The report moved while this was in flight: its failure is not worth reporting.
        if (generation !== reportGeneration.current) return;
        if (!res.ok) {
          notify.error(resolveApiError(tAll, json) ?? t("rowsFailed"));
          return;
        }
        setRows((r) => ({ ...r, [key]: json.rows }));
      } catch {
        if (generation !== reportGeneration.current) return;
        notify.error(tCommon("error.network"));
      }
    }
  }

  const selectedYear = data?.years.find((y) => y.id === query.year) ?? null;

  // The Period picker names the dates below it. Built every render: a preset goes through `update`, which merges into
  // the `query` of the render it was made in, so a memoised copy would undo later changes.
  const period = (() => {
    if (!selectedYear) return undefined;
    const months = monthsOf(selectedYear);
    const options: ComboOption[] = [
      { value: WHOLE_YEAR, label: t("wholeYear") },
      ...months.map((m) => ({
        value: m.key,
        label: `${capitalize(monthName(locale, m.index))} ${m.y}`,
      })),
      { value: CUSTOM, label: t("customPeriod") },
    ];
    // Before the first answer the dates are unset, which the server reads as the whole year.
    const from = query.from ?? selectedYear.fromDate;
    const to = query.to ?? selectedYear.toDate;
    const value = customPeriod
      ? CUSTOM
      : from === selectedYear.fromDate && to === selectedYear.toDate
        ? WHOLE_YEAR
        : (months.find((m) => m.from === from && m.to === to)?.key ?? CUSTOM);
    return {
      options,
      value,
      onPick: (v: string) => {
        if (v === CUSTOM) {
          setCustomPeriod(true);
          return;
        }
        setCustomPeriod(false);
        const month = months.find((m) => m.key === v);
        update(
          month
            ? { from: month.from, to: month.to }
            : { from: selectedYear.fromDate, to: selectedYear.toDate },
        );
      },
      onManual: () => setCustomPeriod(true),
    };
  })();

  const isBalance = query.kind === "BALANCE";
  const showComparison = data?.comparison !== "NONE" && data?.comparison != null;
  const comparisonLabel = data?.comparison === "BUDGET" ? t("budget") : t("priorYear");
  // The column header stays short ("Budget"); the report as a whole names the budget with its year, since it need not
  // be this year's.
  const compared = data?.budgets.find((b) => b.id === data.budget);
  const budgetName = compared && `${compared.year} - ${compared.name}`;
  const comparisonFull =
    data?.comparison === "BUDGET" && budgetName
      ? `${t("budget")} - ${budgetName}`
      : comparisonLabel;
  // Mid-sentence ("compared with …"), so the leading word is lowercased.
  // Only that word: a budget is named "2026 REV", not "2026 rev".
  const comparisonPhrase = `${comparisonLabel.toLowerCase()}${
    budgetName ? ` - ${budgetName}` : ""
  }`;

  // Asked for a comparison the data can't supply: say so rather than drop the column.
  const comparisonMissing =
    data != null && data.comparisonRequested !== "NONE" && data.comparison === "NONE";

  // Which of the two views is on screen. Not simply `mode`: a report kind with
  // no charts to show is always the table, whatever was last switched to.
  const charting = mode === "CHART" && !isBalance;

  // One description of the columns for every table in the report.
  const shape: Shape = {
    isBalance,
    showComparison,
    comparisonLabel,
    diff: view.diff,
    columns,
  };

  const report = data?.report ?? null;

  const syncedNote = selectedYear?.lastSyncAt
    ? t("lastSynced", { time: dateTime(selectedYear.lastSyncAt) })
    : null;

  // One cost centre in full; several by code (fits the bar and printout header). The two buckets read as words.
  const ccBucket = (code: string) =>
    code === "" ? t("noCostCenter") : code === "*" ? t("withCostCenter") : null;
  const ccName = (code: string) =>
    ccBucket(code) ?? `${code} - ${costCenters.find((c) => c.code === code)?.name ?? ""}`;
  const costCenterLabel =
    query.costCenters.length === 0
      ? t("allCostCenters")
      : query.costCenters.length === 1
        ? ccName(query.costCenters[0])
        : query.costCenters.map((c) => ccBucket(c) ?? c).join(", ");

  const periodLabel =
    query.from && query.to
      ? query.from === query.to
        ? date(query.from)
        : `${date(query.from)} - ${date(query.to)}`
      : "";

  function exportCsv() {
    if (!report) return;
    const csv = reportToCsv(report, {
      specified: query.group === "SPECIFIED",
      showComparison,
      comparisonLabel: comparisonFull,
      diff: view.diff,
      columns,
      t,
    });
    const stamp = `${query.from ?? ""}--${query.to ?? ""}`;
    downloadCsv(
      `${t("csv.filename")}-${t(isBalance ? "csv.balance" : "csv.result")}-${stamp}.csv`,
      csv,
    );
  }

  /** What is on screen, named for the print heading: the charts are not a resultatrapport. The word matches the switch. */
  const documentTitle = charting
    ? t("charts.diagram")
    : isBalance
      ? t("balanceReport")
      : t("resultReport");

  // The comparison clause is dropped on the charts unless it is a budget (a prior-year column is not drawn there).
  const summaryComparison = charting ? data?.comparison === "BUDGET" : showComparison;

  return (
    <PageShell title={t("title")}>
      {/* One slot, two cards sharing one `QueryState`. From lg the panel is a column left of the report; below lg it sits above. */}
      <div
        ref={fillRef}
        className={cn(
          // -mb-14 takes back most of the 80px the shell keeps under every page.
          "lg:-mb-14",
          // One or the other, never both: `cn` joins rather than merges.
          hasPanel
            ? "lg:grid lg:grid-cols-[20rem_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)] lg:gap-6"
            : "lg:flex lg:flex-col",
          // `!` because the height is an inline style, and a printout must not stop at the window's edge.
          "print:block print:h-auto!",
        )}
      >
        {hasPanel && (
          // Its own scroll only if the window is too short for every parameter.
          <aside
            data-tour="ledger-params"
            className="mb-5 lg:mb-0 lg:h-full lg:overflow-y-auto lg:overscroll-contain print:hidden"
          >
            {/* The panel's toolbar: period as table or charts, and Export (toggle hidden for a balansrapport so the menu does
              not move). PDF goes through the browser's print dialog; CSV is the table's rows. */}
            <div className="mb-3 flex items-center justify-between gap-3" data-tour="ledger-tools">
              <Menu
                label={t("export")}
                icon={<IconDownload className="size-4" />}
                variant="secondary"
                size="sm"
                align="start"
              >
                <MenuItem onClick={() => window.print()}>{t("exportPdf")}</MenuItem>
                {!charting && report && report.groups.length > 0 && (
                  <MenuItem onClick={exportCsv}>{t("exportCsvExcel")}</MenuItem>
                )}
              </Menu>
              <div className={cn(isBalance && "invisible")} inert={isBalance}>
                <ViewToggle
                  aria-label={t("charts.view")}
                  value={mode}
                  options={[
                    {
                      value: "TABLE",
                      label: t("charts.table"),
                      icon: IconViewTable,
                    },
                    {
                      value: "CHART",
                      label: t("charts.diagram"),
                      icon: IconChart,
                    },
                  ]}
                  onChange={setMode}
                />
              </div>
            </div>
            {charting ? (
              <ChartParameters
                query={query}
                onQuery={update}
                costCenters={costCenters}
                budgets={data.budgets}
                synced={syncedNote}
                period={period}
              />
            ) : (
              <ReportParameters
                query={query}
                onQuery={update}
                costCenters={costCenters}
                budgets={data.budgets}
                diff={view.diff}
                onDiff={(diff) => setView((v) => ({ ...v, diff }))}
                columns={columns}
                onColumns={changeColumns}
                synced={syncedNote}
                period={period}
              />
            )}
          </aside>
        )}

        {/* Hands its leftover height to the report's scrollport; `overflow-y-auto` is a fallback for the charts. */}
        <div className="min-w-0 lg:flex lg:h-full lg:min-h-0 lg:flex-1 lg:flex-col lg:overflow-y-auto print:block print:overflow-visible">
          {error ? (
            <EmptyState title={t("loadFailed")} description={error} />
          ) : loading ? (
            // Re-querying shows the report's own skeleton (same columns); the charts keep the generic sheet.
            charting ? (
              <SkeletonSheet rows={14} columns={5} />
            ) : (
              <div
                className="lg:flex lg:min-h-0 lg:flex-1 lg:flex-col"
                style={reportSurfaceVars(reportColumns(shape))}
              >
                <ReportScroller className="min-h-0 flex-1">
                  <ReportSkeleton shape={shape} />
                </ReportScroller>
              </div>
            )
          ) : !data?.years.length ? (
            <EmptyState title={t("emptyTitle")} description={t("emptyDescription")} />
          ) : (
            <div
              className="space-y-5 lg:flex lg:min-h-0 lg:flex-1 lg:flex-col"
              style={reportSurfaceVars(reportColumns(shape))}
            >
              {/* On paper the panel is gone, so this says what was printed (the charts' heading; the table prints its own). */}
              <div className={cn("hidden", charting && "print:block")}>
                <h2 className="text-lg font-semibold">
                  {documentTitle}
                  {fortnox.companyName ? ` - ${fortnox.companyName}` : ""}
                </h2>
                <p className="mt-0.5 text-sm text-muted">
                  {[
                    selectedYear ? t("financialYear", { year: selectedYear.year }) : null,
                    periodLabel,
                    costCenterLabel,
                    summaryComparison ? t("comparedWith", { comparison: comparisonPhrase }) : null,
                  ]
                    .filter(Boolean)
                    .join(" - ")}
                </p>
                <p className="mt-0.5 text-xs text-muted">
                  {t("printedAt", { time: dateTime(new Date().toISOString()) })}
                </p>
              </div>

              {/* Above the branch: a missing comparison is as true of the charts as of the table. */}
              {comparisonMissing && (
                <p className="text-sm text-warning">
                  {data.comparisonRequested === "BUDGET"
                    ? t("noBudgetForYear", {
                        year: selectedYear?.year ?? t("theYear"),
                      })
                    : t("priorYearNotSynced")}
                </p>
              )}
              {/* Last year's columns asked for with nothing to fill them: said outright, not as a year of zeroes. */}
              {!charting && data.priorAvailable === false && (
                <p className="text-sm text-warning">{t("priorColumnsUnavailable")}</p>
              )}

              {charting ? (
                trendError ? (
                  <EmptyState title={t("charts.loadFailed")} description={trendError} />
                ) : trendLoading || !trend ? (
                  // The table's skeleton, so switching views does not change what waiting looks like.
                  <SkeletonSheet rows={10} columns={4} />
                ) : (
                  <ReportCharts
                    data={trend}
                    monthLabel={chartMonthLabel}
                    noCostCenterLabel={t("noCostCenter")}
                  />
                )
              ) : (
                <>
                  {report && report.groups.length > 0 && (
                    <ReportPrint
                      report={report}
                      view={view}
                      columns={columns}
                      showComparison={showComparison}
                      comparison={data.comparison}
                      companyName={data.meta?.companyName ?? fortnox.companyName ?? null}
                      orgNumber={data.meta?.orgNumber ?? null}
                      latestVouchers={data.meta?.latestVouchers ?? []}
                      financialYear={
                        selectedYear
                          ? {
                              from: selectedYear.fromDate.slice(0, 10),
                              to: selectedYear.toDate.slice(0, 10),
                            }
                          : null
                      }
                      period={data.periodDates ?? null}
                      costCenter={query.costCenters.length === 0 ? null : costCenterLabel}
                      comparedWith={showComparison ? comparisonFull : null}
                    />
                  )}

                  {!report || report.groups.length === 0 ? (
                    <EmptyNote size="page">{t("noRowsInPeriod")}</EmptyNote>
                  ) : (
                    <>
                      {/* Every group card in one scrollport, so columns line up structurally; from lg it is the page's only scroller. */}
                      <ReportScroller className="min-h-0 flex-1 print:hidden">
                        <div className="space-y-5">
                          {report.groups.map((g) => (
                            <ReportGroupCard
                              key={g.costCenterCode ?? "none"}
                              group={g}
                              groupMode={query.group}
                              shape={shape}
                              openKey={openKey}
                              rows={rows}
                              onToggle={toggleRow}
                            />
                          ))}
                          {/* After the last account, the way a printed report closes. */}
                          <ReportResult
                            report={report}
                            shape={shape}
                            label={t("calculatedResult")}
                          />
                        </div>
                      </ReportScroller>
                    </>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </PageShell>
  );
}
