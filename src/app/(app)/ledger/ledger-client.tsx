"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { PageShell } from "@/components/page-shell";
import { useNotify } from "@/components/shell/notifications";
import { resolveApiError } from "@/lib/ui/api-error";
import { useQuery } from "@/components/shell/use-query";
import { Menu, MenuItem } from "@/components/ui/menu";
import { IconDownload } from "@/components/ui/icons";
import { EmptyNote, EmptyState } from "@/components/ui/empty-state";
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

// Month names come from the locale rather than a table of our own: they are
// the one piece of wording here that Intl already knows in every language.
//
// Two lengths, because two places ask. A picker and a readout have room for
// "September"; a chart's x axis has room for twelve labels and therefore for
// none of them at that length.
const monthName = (locale: string, monthIndex: number, long = true) =>
  new Date(Date.UTC(2000, monthIndex, 1)).toLocaleString(locale, {
    month: long ? "long" : "short",
    timeZone: "UTC",
  });

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Every month the financial year spans, as the days it covers. A broken
 * financial year can begin or end inside a month, so the first and last are
 * clipped to the year rather than assumed to be whole.
 */
function monthsOf(year: LedgerYear): { key: string; from: string; to: string; index: number; y: number }[] {
  const out: { key: string; from: string; to: string; index: number; y: number }[] = [];
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const start = new Date(`${year.fromDate}T00:00:00Z`);
  const end = new Date(`${year.toDate}T00:00:00Z`);
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  while (cursor <= end) {
    const y = cursor.getUTCFullYear();
    const m = cursor.getUTCMonth();
    const first = iso(cursor);
    const last = iso(new Date(Date.UTC(y, m + 1, 0)));
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
}: {
  fortnox: FortnoxStatus;
  costCenters: { code: string; name: string }[];
}) {
  const t = useTranslations("ledger");
  const tCommon = useTranslations("common");
  // Un-namespaced, for resolveApiError: the server's codes are absolute paths
  // under `errors`, the same contract useMutation reads them by.
  const tAll = useTranslations();
  const notify = useNotify();
  const { date, dateTime } = useFormat();
  const locale = useLocale();
  // What the charts label a month with. Short and yearless on the axis, since
  // the axis is one financial year and repeating it twelve times says nothing;
  // full in a readout, which is read one at a time.
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

  const [query, setQuery] = useState<QueryState>(INITIAL);
  const [view, setView] = useState<ViewOptions>(EMPTY_VIEW);

  /**
   * Table or charts. The same report either way: everything the parameter panel
   * decides applies to both, and switching does not re-ask the server for the
   * report itself.
   *
   * The charts are their own fetch, made the first time somebody switches and
   * not before. The report is already the slowest request in the app, and a
   * second aggregate over the same table on every parameter change would be
   * paid for by every reader, including the ones who never leave the table.
   */
  const [mode, setMode] = useState<"TABLE" | "CHART">("TABLE");

  // Per-account drill-down state.
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [rows, setRows] = useState<Record<string, RowView[]>>({});
  /**
   * Which report the cached rows belong to.
   *
   * Bumped by `update`, which also empties the cache. Without it a drill-down
   * still in flight when a filter changed would land afterwards and refill the
   * cache it had just been cleared from, putting last period's transactions
   * under an account in this one. Out-of-order responses between two accounts
   * are already harmless, since each writes under its own key; this is about
   * the report moving underneath them.
   */
  const reportGeneration = useRef(0);

  // Control changes can outpace the network; only the newest request may write
  // to state, so a slow early one can't overwrite a fast later one.
  const latest = useRef(0);

  // Whether the dates were last set by hand. The Period picker otherwise works
  // out its choice from the dates, and a hand-typed range that happens to be a
  // whole month would then snap back to naming that month, which is not what
  // the person typing it chose. Cleared by picking a preset or another year.
  const [customPeriod, setCustomPeriod] = useState(false);
  // The result report's figure columns. Their own state rather than part of
  // the view: "Rensa" clears the search and the zero filter, and a reader's
  // choice of columns is not a filter to be cleared with them.
  const [columns, setColumns] = useState<ResultColumn[]>(["period"]);

  // The panel and the report, sized to the window from lg so only the
  // accounts scroll. See useFillViewport.
  const fillRef = useFillViewport<HTMLDivElement>();

  /**
   * The report itself, and the one fetch on this screen that is not a
   * `useQuery`.
   *
   * It cannot be. The server clamps the period into the financial year and
   * picks defaults, and the controls have to follow what it actually reported
   * on, so the response writes back into `query`. Deriving the url from `query`
   * as well would make that write a second request: the echo produces the same
   * clamped values, so it would settle after one extra round trip rather than
   * loop, but one extra round trip on the slowest request in the app, on every
   * parameter change, is not a tidiness worth paying for.
   *
   * The trend fetch below has no such echo, which is exactly why it is
   * declarative and this is not.
   */
  const load = useCallback(async (q: QueryState) => {
    const id = ++latest.current;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ kind: q.kind, group: q.group, compare: q.compare });
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
      // Through resolveApiError, not `json.error` raw: that field carries a
      // message *code*, and printing it put "auth.signedOut" on screen.
      if (!res.ok) throw new Error(resolveApiError(tAll, json) ?? t("loadFailed"));
      setData(json);
      // The server clamps the period to the financial year and picks a default
      // one, so the controls follow what it actually reported on.
      setQuery((cur) => ({
        ...cur,
        year: json.year?.id ?? null,
        from: json.period?.from ?? null,
        to: json.period?.to ?? null,
        // The server resolves which budget was used (the locked one unless
        // asked otherwise), so the picker shows what was compared.
        budget: json.budget ?? null,
      }));
    } catch (e) {
      if (id !== latest.current) return;
      setError(e instanceof Error ? e.message : tCommon("error.network"));
    } finally {
      if (id === latest.current) setLoading(false);
    }
  }, [t, tAll, tCommon]);

  /**
   * The same period, cut for the charts. See /api/ledger/trend.
   *
   * Declarative, unlike `load` above: this one asks a question and reports the
   * answer, so the url *is* the state and `useQuery` can own the rest. It
   * fetches when the charts are on screen and refetches when the parameters
   * they describe move, which is also what stops a reader arriving back at the
   * charts and seeing a picture of a period nobody is looking at.
   *
   * Null while the table is showing, or for a balansrapport: a balance sheet is
   * a position rather than a period, and its "months" would be twelve copies of
   * one balance. The charts view says so instead of drawing something
   * meaningless.
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

  // load() does set state before it awaits, but on this first call it sets
  // `loading` to true and `error` to null, which is what they already are, so
  // React bails out and no extra render happens. The rule cannot see that the
  // values match, hence the exemption rather than a restructure.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load(INITIAL);
  }, [load]);

  // The panel only exists once there is something to report on.
  const hasPanel = data != null && data.years.length > 0;

  // Anything the server decides refetches; the view options below don't.
  function update(patch: Partial<QueryState>) {
    setOpenKey(null);
    setRows({});
    reportGeneration.current++;
    // Nothing to drop for the charts: their url is built from `query`, so a
    // change of period makes it a different url and the fetch follows on its
    // own, if and only if the charts are what is on screen.
    const next = { ...query, ...patch };
    // Summed or per cost centre is not a choice of its own: it follows from
    // which cost centres are asked for. All of them reads as one report of the
    // whole section, summed. Picking any, one or several or either bucket,
    // means those are what is being looked at, so each gets its own card and
    // heading, which also says what the report is of when there is only one.
    next.group = next.costCenters.length > 0 ? "SPECIFIED" : "SUMMED";
    // A new year has its own months, so the period resets with it. The budget
    // does not: any budget may be compared against any year, and one that was
    // picked by hand, with its year on the label, is a choice to keep rather
    // than to quietly undo. Leaving it null instead lets the server offer this
    // year's own, which is what someone who never touched the picker wants.
    if (patch.year !== undefined && patch.year !== query.year) {
      next.from = null;
      next.to = null;
      setCustomPeriod(false);
    }
    // A balansrapport has nothing these charts draw, so the toggle is not
    // offered for one. Somebody standing in the charts when they switch report
    // is put back in the table rather than left looking at a view that has
    // stopped existing.
    if (next.kind !== "RESULT") setMode("TABLE");
    // The result report takes last year as columns, not as its comparison. One
    // switched over with "Föregående år" chosen keeps seeing last year: the
    // comparison becomes the column that says the same.
    if (next.kind === "RESULT" && next.compare === "PRIOR") {
      next.compare = "NONE";
      const withPrior: ResultColumn[] = columns.includes("prior") ? columns : [...columns, "prior"];
      setColumns(withPrior);
      next.prior = true;
    }
    setQuery(next);
    load(next);
  }

  // A change of columns only goes back to the server when it changes whether
  // last year is needed; the rest is the report already in hand, drawn again.
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
      // Per cost centre, the row is that one cost centre. Summed, it is every
      // cost centre the report was filtered to, which with no filter is all.
      if (query.group === "SPECIFIED") params.set("costCenter", g.costCenterCode ?? "");
      else for (const cc of query.costCenters) params.append("costCenter", cc);
      if (query.from) params.set("from", query.from);
      if (query.to) params.set("to", query.to);
      // A failed drill-down used to leave the row open and permanently empty,
      // which reads as "there is nothing behind this account", the opposite of
      // what happened. Say so instead; the row stays open so the retry is one
      // more click on the same place.
      try {
        const res = await fetch(`/api/ledger/rows?${params.toString()}`);
        const json = await res.json().catch(() => ({}));
        // The report moved while this was in flight. Its rows describe a period
        // nobody is looking at any more, and the failure of one is not worth
        // reporting either.
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

  // The Period picker: the whole year, each of its months, or a range of the
  // reader's own. The dates below it are the truth; this names them, and
  // picking one of its presets is a quicker way of setting them.
  //
  // Built every render, not memoised: picking a preset goes through `update`,
  // which merges into the `query` of the render it was made in, so a kept copy
  // would quietly undo whatever else changed since. Thirteen options is no
  // work to rebuild.
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
    // Before the first answer the dates are unset, which the server reads as
    // the whole year, so that is what the picker says too.
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
  // The column header stays short ("Budget"); everything that describes the
  // report as a whole names the budget, since which one was compared against is
  // the whole point of being able to choose. The year is part of the name here:
  // the budget need not be this year's, and a report that says only "Budget –
  // Ursprunglig" over a 2023 budget is a report that misleads.
  const compared = data?.budgets?.find((b) => b.id === data.budget);
  const budgetName = compared && `${compared.year} – ${compared.name}`;
  const comparisonFull =
    data?.comparison === "BUDGET" && budgetName
      ? `${t("budget")} – ${budgetName}`
      : comparisonLabel;
  // Mid-sentence ("compared with …"), so the leading word is lowercased.
  // Only that word: a budget is named "2026 REV", not "2026 rev".
  const comparisonPhrase = `${comparisonLabel.toLowerCase()}${
    budgetName ? ` – ${budgetName}` : ""
  }`;

  // Asked for a comparison the data can't supply. Say so rather than silently
  // dropping the column.
  const comparisonMissing =
    data != null && data.comparisonRequested !== "NONE" && data.comparison === "NONE";

  // Which of the two views is on screen. Not simply `mode`: a report kind with
  // no charts to show is always the table, whatever was last switched to.
  const charting = mode === "CHART" && !isBalance;

  // One description of the columns for every table in the report, so a cost
  // centre's table, the next one's and the bottom line all agree.
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

  // One cost centre is named in full; several by their codes, which is what
  // fits on the bar's summary line and in the printout's header.
  // The two buckets read as words, in full or in a list.
  const ccBucket = (code: string) =>
    code === "" ? t("noCostCenter") : code === "*" ? t("withCostCenter") : null;
  const ccName = (code: string) =>
    ccBucket(code) ?? `${code} – ${costCenters.find((c) => c.code === code)?.name ?? ""}`;
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
        : `${date(query.from)} – ${date(query.to)}`
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
    downloadCsv(`${t("csv.filename")}-${t(isBalance ? "csv.balance" : "csv.result")}-${stamp}.csv`, csv);
  }

  /**
   * What is on screen, named for the heading on paper.
   *
   * Not the report kind on the charts. Somebody looking at five pictures of a
   * period is not looking at a resultatrapport, and a line that opens by
   * naming one is wrong before it reaches the facts that follow. The word is
   * the one on the switch beside the title, so the page calls the thing you
   * picked what it called it when you picked it.
   */
  const documentTitle = charting
    ? t("charts.diagram")
    : isBalance
      ? t("balanceReport")
      : t("resultReport");

  // The comparison clause is dropped on the charts unless it is a budget: a
  // prior-year column is a real thing about the report and nothing the charts
  // draw, so naming it here would describe a screen nobody is looking at.
  const summaryComparison = charting
    ? data?.comparison === "BUDGET"
    : showComparison;

  return (
    <PageShell
      title={t("title")}
      // Beside the title, in the track register, which is the coarsest of the
      // four switchers and the right one here. It looked like a view toggle and
      // is not: the charts are a different question asked of the same period,
      // off their own endpoint (/api/ledger/trend), and not one row of the
      // table is redrawn into them. Everything in the bar below narrows rows,
      // so down there it sat among controls that meant nothing to it and had to
      // hide half of them to say so.
      //
      // Hidden for a balansrapport, which has no period these charts draw. A
      // switch that led to "not for this report" would be a control whose whole
      // job is to disappoint. Hidden rather than left out, so its room stays and
      // the page does not jump when the report changes kind.
      collectionsHidden={isBalance}
      collections={{
        label: t("charts.view"),
        value: mode,
        options: [
          { value: "TABLE", label: t("charts.table") },
          { value: "CHART", label: t("charts.diagram") },
        ],
        onChange: (v) => setMode(v as "TABLE" | "CHART"),
      }}
    >
      {/* One slot, two cards. The parameters are not the same question in the
          two views: most of the report's panel says nothing to a chart, and the
          charts turn its three-way comparison into the one part of it they can
          draw. Both write the same `QueryState`, so the period survives a
          switch and the two views cannot end up describing different things.

          From lg the panel is a column on the left that stays put while the
          report scrolls, the way Fortnox lays out its resultat- and
          balansrapport. Below lg it sits above the report. */}
      <div
        ref={fillRef}
        className={cn(
          // -mb-14 takes back most of the 80px the shell keeps under every
          // page: with nothing below the report to clear, it was a band of
          // empty window under the one box that scrolls.
          "lg:-mb-14",
          // One or the other, never both: `cn` joins rather than merges, so
          // `lg:flex` beside `lg:grid` would be settled by stylesheet order.
          hasPanel
            ? "lg:grid lg:grid-cols-[20rem_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)] lg:gap-6"
            : "lg:flex lg:flex-col",
          // `!` because the height is an inline style, which a plain class
          // cannot beat, and a printout must not stop at the window's edge.
          "print:block print:h-auto!",
        )}
      >
      {hasPanel && (
        // Its own scroll only if the window is too short for every parameter.
        <aside
          className="mb-5 lg:mb-0 lg:h-full lg:overflow-y-auto lg:overscroll-contain print:hidden"
        >
          {charting ? (
            <ChartParameters
              query={query}
              onQuery={update}
              years={data.years}
              costCenters={costCenters}
              budgets={data.budgets ?? []}
              synced={syncedNote}
              period={period}
            />
          ) : (
            <ReportParameters
              query={query}
              onQuery={update}
              years={data.years}
              costCenters={costCenters}
              budgets={data.budgets ?? []}
              diff={view.diff}
              onDiff={(diff) => setView((v) => ({ ...v, diff }))}
              columns={columns}
              onColumns={changeColumns}
              synced={syncedNote}
              period={period}
            />
          )}
          {/* Under the settings it is the output of. One menu rather than a
              button per format: which file is wanted is one question. PDF goes
              through the browser's print dialog, where "Save as PDF" is the
              destination; the printout below is laid out for exactly that. CSV
              is the table's rows, so it is offered with the table only. */}
          {data?.years.length ? (
            <div className="mt-3 print:hidden">
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
            </div>
          ) : null}
        </aside>
      )}

      {/* A column that hands its leftover height to the report's scrollport.
          `overflow-y-auto` is only a fallback: the charts are not a scrollport
          of their own, and a tall chart view still has to be reachable. */}
      <div className="min-w-0 lg:flex lg:h-full lg:min-h-0 lg:flex-1 lg:flex-col lg:overflow-y-auto print:block print:overflow-visible">
      {error ? (
        <EmptyState title={t("loadFailed")} description={error} />
      ) : loading ? (
        // Changing a parameter re-queries the whole report, which is the slowest
        // fetch in the app. While it runs, the report's own skeleton stands in
        // its scrollport: same columns, same headings, rows to come. The charts
        // have no columns to borrow and keep the generic sheet.
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
          {/* On paper the panel is gone, so this is the only thing
              that says what was printed. The charts' heading. The table prints
              as a report of its own, in Fortnox's form, below. */}
          <div className={cn("hidden", charting && "print:block")}>
            <h2 className="text-lg font-semibold">
              {documentTitle}
              {fortnox.companyName ? ` – ${fortnox.companyName}` : ""}
            </h2>
            <p className="mt-0.5 text-sm text-muted">
              {[
                selectedYear ? t("financialYear", { year: selectedYear.year }) : null,
                periodLabel,
                costCenterLabel,
                summaryComparison ? t("comparedWith", { comparison: comparisonPhrase }) : null,
              ]
                .filter(Boolean)
                .join(" – ")}
            </p>
            <p className="mt-0.5 text-xs text-muted">
              {t("printedAt", { time: dateTime(new Date().toISOString()) })}
            </p>
          </div>

          {/* Above the branch: a comparison that could not be applied is as
              true of the charts as of the table, and the charts pace against
              exactly the budget this warns is missing. */}
          {comparisonMissing && (
            <p className="text-sm text-warning">
              {data?.comparisonRequested === "BUDGET"
                ? t("noBudgetForYear", { year: selectedYear?.year ?? t("theYear") })
                : t("priorYearNotSynced")}
            </p>
          )}
          {/* Last year's columns asked for and nothing to fill them with. Said
              outright, or the empty columns read as a year of zeroes. */}
          {!charting && data?.priorAvailable === false && (
            <p className="text-sm text-warning">{t("priorColumnsUnavailable")}</p>
          )}

          {charting ? (
            trendError ? (
              <EmptyState title={t("charts.loadFailed")} description={trendError} />
            ) : trendLoading || !trend ? (
              // The same skeleton the table uses, in the same place, so
              // switching views does not also change what waiting looks like.
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
              comparison={data?.comparison ?? "NONE"}
              companyName={data?.meta?.companyName ?? fortnox.companyName ?? null}
              orgNumber={data?.meta?.orgNumber ?? null}
              latestVouchers={data?.meta?.latestVouchers ?? []}
              financialYear={
                selectedYear
                  ? { from: selectedYear.fromDate.slice(0, 10), to: selectedYear.toDate.slice(0, 10) }
                  : null
              }
              period={data?.periodDates ?? null}
              costCenter={query.costCenters.length === 0 ? null : costCenterLabel}
              comparedWith={showComparison ? comparisonFull : null}
            />
          )}

          {!report || report.groups.length === 0 ? (
            <EmptyNote size="page">
              {t("noRowsInPeriod")}
            </EmptyNote>
          ) : (
            <>
              {/* Every group card in one scrollport: the columns then line up
                  across cost centres because they are laid out by the same
                  grid, not because anything keeps them in step. From lg it is
                  also the only thing on the page that scrolls. */}
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

/**
 * Sizes an element to the rest of the window below where it starts, from lg.
 *
 * The ledger is read by scrolling a long list of accounts against a panel of
 * parameters and a bar of view options, and when the whole page scrolled, both
 * of those went off the top while the column heads went with them. Sized to
 * the window, the page itself has nothing to scroll and the report's own
 * scrollport is the only thing that moves.
 *
 * Measured rather than written as a calc(): what sits above it (the page
 * header, a sync line that comes and goes) has no fixed height. 24px is kept
 * free at the bottom, the same margin the card keeps on its other sides.
 * Below lg the parameters sit above the report instead of beside it, so the
 * page has to scroll to reach them, and nothing is sized.
 */
function useFillViewport<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const wide = window.matchMedia("(min-width: 1024px)");
    const fit = () => {
      if (!wide.matches) {
        el.style.height = "";
        return;
      }
      const top = el.getBoundingClientRect().top;
      // Floored, so a fractional pixel cannot hand the page a scrollbar back.
      el.style.height = `${Math.max(320, Math.floor(window.innerHeight - top - 24))}px`;
    };
    fit();
    // The header above it can change height (the sync line, a wrapped title),
    // and that moves where this starts. The page shell's root is what grows
    // when it does. Setting this element's own height lands on the same value
    // next time round, so it settles rather than loops.
    const observer = new ResizeObserver(fit);
    const shell = el.parentElement?.parentElement;
    if (shell) observer.observe(shell);
    window.addEventListener("resize", fit);
    wide.addEventListener("change", fit);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", fit);
      wide.removeEventListener("change", fit);
    };
  }, []);
  return ref;
}
