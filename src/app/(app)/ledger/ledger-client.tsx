"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { PageShell } from "@/components/page-shell";
import { useNotify } from "@/components/shell/notifications";
import { resolveApiError } from "@/lib/ui/api-error";
import { Button } from "@/components/ui/button";
import { EmptyNote, EmptyState } from "@/components/ui/empty-state";
import { SkeletonSheet } from "@/components/ui/skeleton";
import { type ComboOption } from "@/components/ui/combobox";

import type { FortnoxStatus } from "@/lib/domain/types";
import { ReportBar, ReportParameters } from "./report-controls";
import {
  ReportGroupCard,
  ReportScroller,
  ReportTotalBar,
  reportColumns,
  reportSurfaceVars,
  useColumnScrollSync,
  type Shape,
} from "./report-table";
import { downloadCsv, filterReport, reportToCsv } from "./report-view";
import { useFormat } from "@/lib/ui/use-format";
import {
  EMPTY_VIEW,
  type LedgerYear,
  type QueryState,
  type ReportAccount,
  type ReportGroup,
  type ReportResponse,
  type RowView,
  type ViewOptions,
} from "./report-types";

// Month names come from the locale rather than a table of our own: they are
// the one piece of wording here that Intl already knows in every language.
const monthName = (locale: string, monthIndex: number) =>
  new Date(Date.UTC(2000, monthIndex, 1)).toLocaleString(locale, {
    month: "long",
    timeZone: "UTC",
  });

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// Every month the financial year spans, as YYYY-MM — a broken financial year
// doesn't start in January, so this is derived from the year's own dates.
function monthsOf(year: LedgerYear, locale: string): ComboOption[] {
  const out: ComboOption[] = [];
  const start = new Date(`${year.fromDate}T00:00:00Z`);
  const end = new Date(`${year.toDate}T00:00:00Z`);
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  while (cursor <= end) {
    const value = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}`;
    out.push({
      value,
      label: `${capitalize(monthName(locale, cursor.getUTCMonth()))} ${cursor.getUTCFullYear()}`,
    });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return out;
}

const INITIAL: QueryState = {
  kind: "RESULT",
  year: null,
  from: null,
  to: null,
  costCenter: null,
  group: "SUMMED",
  compare: "NONE",
  budget: null,
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
  const { dateTime } = useFormat();
  const locale = useLocale();
  const monthLabel = (m: string | null) => {
    if (!m) return "";
    const [y, mm] = m.split("-");
    return `${capitalize(monthName(locale, Number(mm) - 1))} ${y}`;
  };

  const [data, setData] = useState<ReportResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState<QueryState>(INITIAL);
  const [view, setView] = useState<ViewOptions>(EMPTY_VIEW);

  // Per-account drill-down state.
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [rows, setRows] = useState<Record<string, RowView[]>>({});

  // Control changes can outpace the network; only the newest request may write
  // to state, so a slow early one can't overwrite a fast later one.
  const latest = useRef(0);

  // Once the parameter panel has scrolled out of sight, the bar over the table
  // takes over saying what the report is of, and offers the way back to it.
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelOnScreen, setPanelOnScreen] = useState(true);

  // Joins every table's sideways scrolling, bottom line included.
  const registerScroll = useColumnScrollSync();

  const load = useCallback(async (q: QueryState) => {
    const id = ++latest.current;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ kind: q.kind, group: q.group, compare: q.compare });
      if (q.year != null) params.set("year", String(q.year));
      if (q.from) params.set("from", q.from);
      if (q.to) params.set("to", q.to);
      // Absent means every cost centre; empty means the rows carrying none.
      if (q.costCenter != null) params.set("costCenter", q.costCenter);
      if (q.budget) params.set("budget", q.budget);
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

  // load() does set state before it awaits — but on this first call it sets
  // `loading` to true and `error` to null, which is what they already are, so
  // React bails out and no extra render happens. The rule cannot see that the
  // values match, hence the exemption rather than a restructure.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load(INITIAL);
  }, [load]);

  // The panel only exists once there is something to report on, so this waits
  // for it. The margin is the mobile header's 3.5rem: a panel hidden behind it
  // is off screen as far as the reader is concerned.
  const hasPanel = data != null && data.years.length > 0;
  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => setPanelOnScreen(entry.isIntersecting),
      { rootMargin: "-56px 0px 0px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasPanel]);

  // Anything the server decides refetches; the view options below don't.
  function update(patch: Partial<QueryState>) {
    setOpenKey(null);
    setRows({});
    const next = { ...query, ...patch };
    // A new year has its own months, so the period resets with it. The budget
    // does not: any budget may be compared against any year, and one that was
    // picked by hand — with its year on the label — is a choice to keep rather
    // than to quietly undo. Leaving it null instead lets the server offer this
    // year's own, which is what someone who never touched the picker wants.
    if (patch.year !== undefined && patch.year !== query.year) {
      next.from = null;
      next.to = null;
    }
    setQuery(next);
    load(next);
  }

  async function toggleRow(g: ReportGroup, acct: ReportAccount) {
    const key = `${g.costCenterCode ?? ""}|${acct.account}`;
    if (openKey === key) {
      setOpenKey(null);
      return;
    }
    setOpenKey(key);
    if (!rows[key] && query.year != null) {
      const params = new URLSearchParams({
        year: String(query.year),
        account: acct.account,
      });
      // In summed grouping the row spans every cost centre, so the filter is
      // left off entirely rather than scoped to a bucket.
      if (query.group === "SPECIFIED") params.set("costCenter", g.costCenterCode ?? "");
      else if (query.costCenter != null) params.set("costCenter", query.costCenter);
      if (query.from) params.set("from", query.from);
      if (query.to) params.set("to", query.to);
      // A failed drill-down used to leave the row open and permanently empty,
      // which reads as "there is nothing behind this account" — the opposite of
      // what happened. Say so instead; the row stays open so the retry is one
      // more click on the same place.
      try {
        const res = await fetch(`/api/ledger/rows?${params.toString()}`);
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          notify.error(resolveApiError(tAll, json) ?? t("rowsFailed"));
          return;
        }
        setRows((r) => ({ ...r, [key]: json.rows }));
      } catch {
        notify.error(tCommon("error.network"));
      }
    }
  }

  const selectedYear = data?.years.find((y) => y.id === query.year) ?? null;
  const monthOptions = useMemo<ComboOption[]>(
    () => (selectedYear ? monthsOf(selectedYear, locale) : []),
    [selectedYear, locale],
  );

  const isBalance = query.kind === "BALANCE";
  const showComparison = data?.comparison !== "NONE" && data?.comparison != null;
  const comparisonLabel = data?.comparison === "BUDGET" ? t("budget") : t("priorYear");
  // The column header stays short ("Budget"); everything that describes the
  // report as a whole names the budget, since which one was compared against is
  // the whole point of being able to choose. The year is part of the name here:
  // the budget need not be this year's, and a report that says only "Budget ·
  // Ursprunglig" over a 2023 budget is a report that misleads.
  const compared = data?.budgets?.find((b) => b.id === data.budget);
  const budgetName = compared && `${compared.year} · ${compared.name}`;
  const comparisonFull =
    data?.comparison === "BUDGET" && budgetName
      ? `${t("budget")} · ${budgetName}`
      : comparisonLabel;
  // Mid-sentence ("compared with …"), so the leading word is lowercased — but
  // only that word: a budget is named "2026 REV", not "2026 rev".
  const comparisonPhrase = `${comparisonLabel.toLowerCase()}${
    budgetName ? ` · ${budgetName}` : ""
  }`;

  // Asked for a comparison the data can't supply — say so rather than silently
  // dropping the column.
  const comparisonMissing =
    data != null && data.comparisonRequested !== "NONE" && data.comparison === "NONE";

  // One description of the columns for every table in the report, so a cost
  // centre's table, the next one's and the bottom line all agree.
  const shape: Shape = {
    isBalance,
    showComparison,
    comparisonLabel,
    share: view.share,
    diff: view.diff,
  };

  const filtered = useMemo(
    () => (data?.report ? filterReport(data.report, view) : null),
    [data, view],
  );
  const report = filtered?.report ?? null;

  const costCenterLabel =
    query.costCenter == null
      ? t("allCostCenters")
      : query.costCenter === ""
        ? t("noCostCenter")
        : `${query.costCenter} · ${costCenters.find((c) => c.code === query.costCenter)?.name ?? ""}`;

  const periodLabel =
    query.from && query.to
      ? query.from === query.to
        ? monthLabel(query.from)
        : `${monthLabel(query.from)} – ${monthLabel(query.to)}`
      : "";

  function exportCsv() {
    if (!report) return;
    const csv = reportToCsv(report, {
      specified: query.group === "SPECIFIED",
      showComparison,
      comparisonLabel: comparisonFull,
      share: view.share,
      diff: view.diff,
      t,
    });
    const stamp = `${query.from ?? ""}--${query.to ?? ""}`;
    downloadCsv(`${t("csv.filename")}-${t(isBalance ? "csv.balance" : "csv.result")}-${stamp}.csv`, csv);
  }

  const summary = [
    isBalance ? t("balanceReport") : t("resultReport"),
    selectedYear ? String(selectedYear.year) : null,
    periodLabel,
    costCenterLabel,
    showComparison ? t("vs", { comparison: comparisonPhrase }) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <PageShell
      title={t("title")}
      description={`${t("description")}${
        selectedYear && selectedYear.lastSyncAt
          ? ` ${t("lastSynced", { time: dateTime(selectedYear.lastSyncAt) })}`
          : ""
      }`}
      action={
        hasPanel ? (
          <div className="flex gap-2 print:hidden">
            <Button
              variant="secondary"
              size="sm"
              onClick={exportCsv}
              disabled={!report || report.groups.length === 0}
            >
              {t("exportCsv")}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => window.print()}
              disabled={!report || report.groups.length === 0}
            >
              {t("print")}
            </Button>
          </div>
        ) : undefined
      }
    >

      {hasPanel && (
        <div ref={panelRef}>
          <ReportParameters
            query={query}
            onQuery={update}
            years={data.years}
            months={monthOptions}
            costCenters={costCenters}
            budgets={data.budgets ?? []}
          />
        </div>
      )}

      {error ? (
        <EmptyState title={t("loadFailed")} description={error} />
      ) : loading ? (
        // Changing a parameter re-queries the whole report, which is the slowest
        // fetch in the app; the sheet shape keeps the page from collapsing to a
        // single line of text and back on every change.
        <SkeletonSheet rows={14} columns={5} />
      ) : !data?.years.length ? (
        <EmptyState title={t("emptyTitle")} description={t("emptyDescription")} />
      ) : (
        <div className="space-y-5" style={reportSurfaceVars(reportColumns(shape, view.share))}>
          <ReportBar
            view={view}
            onView={(patch) => setView((v) => ({ ...v, ...patch }))}
            showComparison={showComparison}
            summary={summary}
            showSummary={!panelOnScreen}
            onEditParameters={() =>
              panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
            }
            count={
              filtered?.filtered ? (
                <>
                  {t("showingAccounts", { shown: filtered.shown, total: filtered.total })}{" "}
                  <button
                    type="button"
                    onClick={() => setView(EMPTY_VIEW)}
                    className="font-medium text-accent hover:underline"
                  >
                    {t("clear")}
                  </button>
                </>
              ) : (
                t("accountCount", { count: filtered?.total ?? 0 })
              )
            }
          />

          {/* On paper the panel and the bar are gone, so this is the only thing
              that says what was printed. */}
          <div className="hidden print:block">
            <h2 className="text-lg font-semibold">
              {isBalance ? t("balanceReport") : t("resultReport")}
              {fortnox.companyName ? ` · ${fortnox.companyName}` : ""}
            </h2>
            <p className="mt-0.5 text-sm text-muted">
              {[
                selectedYear ? t("financialYear", { year: selectedYear.year }) : null,
                periodLabel,
                costCenterLabel,
                showComparison ? t("comparedWith", { comparison: comparisonPhrase }) : null,
                filtered?.filtered
                  ? t("selection", { shown: filtered.shown, total: filtered.total })
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
            <p className="mt-0.5 text-xs text-muted">
              {t("printedAt", { time: dateTime(new Date().toISOString()) })}
            </p>
          </div>

          {filtered?.filtered && (
            <p className="text-sm text-muted print:hidden">{t("totalsNote")}</p>
          )}

          {comparisonMissing && (
            <p className="text-sm text-warning">
              {data?.comparisonRequested === "BUDGET"
                ? t("noBudgetForYear", { year: selectedYear?.year ?? t("theYear") })
                : t("priorYearNotSynced")}
            </p>
          )}

          {!report || report.groups.length === 0 ? (
            <EmptyNote size="page">
              {filtered?.filtered ? t("noAccountsMatch") : t("noRowsInPeriod")}
            </EmptyNote>
          ) : (
            <>
              {/* Every group card in one scrollport: the columns then line up
                  across cost centres because they are laid out by the same
                  grid, not because anything keeps them in step. */}
              <ReportScroller register={registerScroll}>
                <div className="space-y-5">
                  {report.groups.map((g) => (
                    <ReportGroupCard
                      key={g.costCenterCode ?? "none"}
                      group={g}
                      groupMode={query.group}
                      shape={shape}
                      view={view}
                      openKey={openKey}
                      rows={rows}
                      onToggle={toggleRow}
                    />
                  ))}
                </div>
              </ReportScroller>

              {/* The bottom line stays in view: on a report this long it is
                  the one figure you are usually scrolling towards. */}
              <ReportTotalBar
                report={report}
                shape={shape}
                view={view}
                label={t("calculatedResult")}
                register={registerScroll}
              />
            </>
          )}
        </div>
      )}
    </PageShell>
  );
}
