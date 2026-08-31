"use client";

// A list narrowed in the browser rather than by the database.
//
// For the handful of screens where that is the right thing: the admin cost
// centre list, the budget index, the dashboard's two panels. Each holds every
// row it will ever show (a few dozen), so a round trip per keystroke would buy
// nothing, and the state can stay in the component instead of the URL.
//
// It does the filtering, the sorting and the cut, then hands DataTable the page
// that came out. DataTable itself renders and never chooses: that separation is
// the point, because the two used to be one component behind a `server` flag,
// and on the server side every `predicate` here was quietly never called.
//
// Anything paged by the database uses DataTable directly with
// `useUrlTableControls`.
import { useMemo } from "react";

import { isWholeDate } from "@/lib/data/list-query";
import {
  DataTable,
  type Column,
  type SelectFilter,
  type TabFilter,
  type TabOption,
} from "./data-table";
import type { ClientControls } from "@/lib/data/use-list-query";

/**
 * A tab, and the rows it selects.
 *
 * The predicate is what makes this the browser's version: it is called, here,
 * on every row. An option without one (e.g. "Alla") matches everything.
 */
export type ClientTabOption<T> = TabOption & { predicate?: (row: T) => boolean };
export type ClientTabFilter<T> = ClientTabOption<T>[];

/** A dropdown filter whose options each select rows, OR-ed across the picked. */
export type ClientSelectFilter<T> = {
  label: string;
  options: { value: string; label: string; predicate?: (row: T) => boolean }[];
};

// One collator for every sort, rather than an implicit one per comparison.
const collator = new Intl.Collator("sv");

// Compose every active filter (column (text/date), tab and dropdown) into a
// single predicate. Text columns match if any one contains the query; each date
// column must fall within the from/to range; the dropdown's picked options are
// OR-ed; then the tab predicate. A row is kept only if it passes them all.
function buildRowFilter<T>(
  cols: Column<T>[],
  controls: ClientControls,
  activeTab: ClientTabOption<T> | undefined,
  filter: ClientSelectFilter<T> | undefined,
): (row: T) => boolean {
  const { query, dateFrom: from, dateTo: to } = controls;
  const q = query.trim().toLowerCase();
  const pick = (flag: "searchable" | "dateRange") =>
    cols.flatMap((c) => (c[flag] && c.value ? [c.value] : []));

  const search = q ? pick("searchable") : [];
  // Half-typed dates are ignored, the same way parseListQuery drops them from a
  // URL: "2026-0" as an upper bound excludes the whole of 2026, so a list would
  // empty itself between the fifth keystroke and the tenth.
  const after = isWholeDate(from) ? from : "";
  const before = isWholeDate(to) ? to : "";
  const dates = after || before ? pick("dateRange") : [];
  const within = (v: string) => (!after || v >= after) && (!before || v <= before);
  const tabPred = activeTab?.predicate;
  const picked = (filter?.options ?? [])
    .filter((o) => controls.picks.includes(o.value))
    .flatMap((o) => (o.predicate ? [o.predicate] : []));

  return (row) =>
    (!search.length || search.some((v) => String(v(row)).toLowerCase().includes(q))) &&
    dates.every((v) => within(String(v(row)))) &&
    (!picked.length || picked.some((p) => p(row))) &&
    (tabPred?.(row) ?? true);
}

export function ClientDataTable<T>({
  columns,
  rows,
  controls,
  tabs,
  filter,
  action,
  searchPlaceholder,
  rowKey,
  rowClassName,
  rowHref,
  expansion,
  expandAll,
  empty,
}: {
  columns: Column<T>[];
  /** Every row the list will ever show, not a page. */
  rows: T[];
  controls: ClientControls;
  tabs?: ClientTabFilter<T>;
  filter?: ClientSelectFilter<T>;
  /** What you can do to this list, see DataTable's own `action`. */
  action?: React.ReactNode;
  searchPlaceholder?: string;
  rowKey: (row: T) => string;
  rowClassName?: (row: T) => string | undefined;
  rowHref?: (row: T) => string;
  /** What sits under a row when opened, see DataTable's own `expansion`. */
  expansion?: (row: T) => React.ReactNode;
  expandAll?: boolean;
  /** Passed straight to DataTable, a string, see its note there. */
  empty?: string;
}) {
  const cols = useMemo(() => columns.filter((c) => !c.hidden), [columns]);
  const activeTab = tabs?.find((o) => o.value === controls.tab) ?? tabs?.[0];

  const { query, dateFrom, dateTo, picks, sortKey, sortDir } = controls;
  const data = useMemo(() => {
    const filtered = rows.filter(buildRowFilter(cols, controls, activeTab, filter));
    const col = sortKey ? cols.find((c) => c.key === sortKey) : undefined;
    if (!col?.sortable || !col.value) return filtered;
    const dir = sortDir === "asc" ? 1 : -1;
    const get = col.value;
    return filtered.sort((a, b) => {
      const av = get(a);
      const bv = get(b);
      if (typeof av === "number" && typeof bv === "number") return dir * (av - bv);
      return dir * collator.compare(String(av), String(bv));
    });
    // `controls` is recreated every render; the fields the filter reads are
    // listed individually so the work only repeats when one of them changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, cols, activeTab, filter, query, dateFrom, dateTo, picks, sortKey, sortDir]);

  // What DataTable is handed: the page, the count behind it, and tabs stripped
  // of the predicates it has no use for.
  const plainTabs: TabFilter | undefined = useMemo(
    () => tabs?.map(({ value, label }) => ({ value, label })),
    [tabs],
  );
  const plainFilter: SelectFilter | undefined = useMemo(
    () =>
      filter && {
        label: filter.label,
        options: filter.options.map(({ value, label }) => ({ value, label })),
      },
    [filter],
  );

  return (
    <DataTable
      columns={columns}
      rows={controls.paginate(data)}
      controls={{ ...controls, server: true, total: data.length }}
      tabs={plainTabs}
      filter={plainFilter}
      action={action}
      searchPlaceholder={searchPlaceholder}
      rowKey={rowKey}
      rowClassName={rowClassName}
      rowHref={rowHref}
      expansion={expansion}
      expandAll={expandAll}
      empty={empty}
    />
  );
}
