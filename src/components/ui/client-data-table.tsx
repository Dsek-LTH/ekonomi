"use client";

// Filters, sorts and cuts in the browser, for lists that hold every row they will show. DataTable only renders.
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

/** A tab and the rows it selects. An option without a predicate (e.g. "Alla") matches everything. */
export type ClientTabOption<T> = TabOption & { predicate?: (row: T) => boolean };
export type ClientTabFilter<T> = ClientTabOption<T>[];

/** A dropdown filter whose options each select rows, OR-ed across the picked. */
export type ClientSelectFilter<T> = {
  label: string;
  options: { value: string; label: string; predicate?: (row: T) => boolean }[];
};

type ClientSelectFilters<T> = ClientSelectFilter<T> | ClientSelectFilter<T>[];

const asFilters = <T,>(filter: ClientSelectFilters<T> | undefined): ClientSelectFilter<T>[] =>
  filter ? (Array.isArray(filter) ? filter : [filter]) : [];

const collator = new Intl.Collator("sv");

// Every active filter composed into one predicate: text columns match if any contains the query, date columns must be in range,
// a dropdown's picked options are OR-ed and the dropdowns AND-ed, then the tab.
function buildRowFilter<T>(
  cols: Column<T>[],
  controls: ClientControls,
  activeTab: ClientTabOption<T> | undefined,
  filter: ClientSelectFilters<T> | undefined,
): (row: T) => boolean {
  const { query, dateFrom: from, dateTo: to } = controls;
  const q = query.trim().toLowerCase();
  const pick = (flag: "searchable" | "dateRange") =>
    cols.flatMap((c) => (c[flag] && c.value ? [c.value] : []));

  const search = q ? pick("searchable") : [];
  // Half-typed dates are ignored (as parseListQuery does): "2026-0" as an upper bound would empty the list.
  const after = isWholeDate(from) ? from : "";
  const before = isWholeDate(to) ? to : "";
  const dates = after || before ? pick("dateRange") : [];
  const within = (v: string) => (!after || v >= after) && (!before || v <= before);
  const tabPred = activeTab?.predicate;
  // A dropdown with nothing picked drops out rather than matching nothing.
  const groups = asFilters(filter)
    .map((f) =>
      f.options
        .filter((o) => controls.picks.includes(o.value))
        .flatMap((o) => (o.predicate ? [o.predicate] : [])),
    )
    .filter((g) => g.length > 0);

  return (row) =>
    (!search.length || search.some((v) => String(v(row)).toLowerCase().includes(q))) &&
    dates.every((v) => within(String(v(row)))) &&
    groups.every((g) => g.some((p) => p(row))) &&
    (tabPred?.(row) ?? true);
}

/** The rows the table shows across every page, in its order: for a page that needs to know what is next. */
export function visibleRows<T>({
  columns,
  rows,
  controls,
  tabs,
  filter,
}: {
  columns: Column<T>[];
  rows: T[];
  controls: ClientControls;
  tabs?: ClientTabFilter<T>;
  filter?: ClientSelectFilters<T>;
}): T[] {
  const cols = columns.filter((c) => !c.hidden);
  const activeTab = tabs?.find((o) => o.value === controls.tab) ?? tabs?.[0];
  const filtered = rows.filter(buildRowFilter(cols, controls, activeTab, filter));
  const col = controls.sortKey ? cols.find((c) => c.key === controls.sortKey) : undefined;
  if (!col?.sortable || !col.value) return filtered;
  const dir = controls.sortDir === "asc" ? 1 : -1;
  const get = col.value;
  return filtered.sort((a, b) => {
    const av = get(a);
    const bv = get(b);
    if (typeof av === "number" && typeof bv === "number") return dir * (av - bv);
    return dir * collator.compare(String(av), String(bv));
  });
}

export function ClientDataTable<T>({
  columns,
  rows,
  controls,
  tabs,
  filter,
  summary,
  action,
  actionPanel,
  searchPlaceholder,
  rowKey,
  rowClassName,
  rowHref,
  rowScroll,
  expansion,
  expandAll,
  empty,
}: {
  columns: Column<T>[];
  rows: T[];
  controls: ClientControls;
  tabs?: ClientTabFilter<T>;
  filter?: ClientSelectFilters<T>;
  summary?: React.ReactNode;
  action?: React.ReactNode;
  actionPanel?: React.ReactNode;
  searchPlaceholder?: string;
  rowKey: (row: T) => string;
  rowClassName?: (row: T) => string | undefined;
  rowHref?: (row: T) => string;
  rowScroll?: boolean;
  expansion?: (row: T) => React.ReactNode;
  expandAll?: boolean;
  empty?: string;
}) {
  const cols = useMemo(() => columns.filter((c) => !c.hidden), [columns]);

  const { query, dateFrom, dateTo, picks, sortKey, sortDir } = controls;
  const data = useMemo(
    () => visibleRows({ columns: cols, rows, controls, tabs, filter }),
    // `controls` is recreated every render; the fields the filter reads are
    // listed individually so the work only repeats when one of them changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, cols, tabs, filter, controls.tab, query, dateFrom, dateTo, picks, sortKey, sortDir],
  );

  const plainTabs: TabFilter | undefined = useMemo(
    () => tabs?.map(({ value, label, badge, waiting }) => ({ value, label, badge, waiting })),
    [tabs],
  );
  const plainFilter: SelectFilter[] = useMemo(
    () =>
      asFilters(filter).map((f) => ({
        label: f.label,
        options: f.options.map(({ value, label }) => ({ value, label })),
      })),
    [filter],
  );

  return (
    <DataTable
      columns={columns}
      rows={controls.paginate(data)}
      controls={{ ...controls, server: true, total: data.length }}
      tabs={plainTabs}
      filter={plainFilter}
      summary={summary}
      action={action}
      actionPanel={actionPanel}
      searchPlaceholder={searchPlaceholder}
      rowKey={rowKey}
      rowClassName={rowClassName}
      rowHref={rowHref}
      rowScroll={rowScroll}
      expansion={expansion}
      expandAll={expandAll}
      empty={empty}
    />
  );
}
