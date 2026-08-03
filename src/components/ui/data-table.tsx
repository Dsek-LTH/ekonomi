"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/ui/utils";
import { MultiCombobox } from "./combobox";
import { EmptyNote } from "./empty-state";
import { DateInput } from "./field";
import { SearchInput } from "./search-input";
import { SegmentedControl } from "./segmented-control";
import { Pagination, SortableHeader, type TableControlState } from "./table-controls";

// One table for every data list. Declare columns; DataTable renders the filter
// bar (search / date range / tabs, all derived from the column declarations),
// the header (sortable where a column has a `value`), the filtered and sorted
// rows, and its own pagination footer — so the visible count always matches the
// filtered rows. Pages keep their own <Card> wrapper around it.
//
// Below md a row is drawn as a stacked card instead of a table row: five to
// seven columns cannot be read on a phone, and side-scrolling a list you are
// meant to skim is worse than not showing it. Each column says where it lands in
// that card via `mobile` (see below); the filtering, sorting and pagination
// above are shared, so both renderings always show the same rows. md is the
// breakpoint the sidebar already switches at — one "this is a small screen" line
// for the whole app rather than two.
//
// That only holds because the sidebar is the 64px rail from md and not the full
// column until lg (see components/app-shell.tsx). With a 256px column at md the
// table below inherited under 500px and its trailing columns fell off the right
// edge, which made 768 read worse than 767. If that ever changes back, this
// breakpoint has to move to lg with it.

// A tab (segmented filter) co-locates each option's label with the predicate
// that selects its rows. DataTable renders the segmented control from these and
// applies the active option's predicate automatically. An option without a
// predicate (e.g. "Alla") matches every row; the first option is the default.
export type TabOption<T> = {
  value: string;
  label: string;
  predicate?: (row: T) => boolean;
};

export type TabFilter<T> = TabOption<T>[];

// A dropdown filter over one dimension of the rows, for a dimension with more
// values than a segmented control can carry — status, of which there are seven.
// Several options can be on at once and a row is kept if it matches any of them,
// so the options are OR-ed; none picked means the filter isn't narrowing
// anything. That resting state is why this doesn't replace `tabs`, which always
// has exactly one option in force and reads as a coarse cut of the whole list.
export type SelectFilter<T> = {
  // The trigger's text while nothing is picked — it stands for every row, so
  // say so ("Alla statusar") rather than naming the column.
  label: string;
  options: { value: string; label: string; predicate: (row: T) => boolean }[];
};

export interface Column<T> {
  key: string;
  header: React.ReactNode;
  cell: (row: T) => React.ReactNode;
  // The column's comparable value. On its own it does nothing; the flags below
  // opt it into sorting, search and/or date filtering.
  value?: (row: T) => string | number;
  // Make the header clickable to sort by `value`.
  sortable?: boolean;
  // Include this column's `value` in the free-text search (OR-ed across all
  // searchable columns).
  searchable?: boolean;
  // Treat `value` as a date ("YYYY-MM-DD") and wire it to the from/to inputs.
  dateRange?: boolean;
  align?: "left" | "right" | "center";
  className?: string; // extra classes applied to both <th> and <td>
  hidden?: boolean; // drop the column entirely (e.g. role-dependent)
  // Where this column lands in the phone card. `className` is deliberately not
  // applied there — it carries table geometry (`w-44`, `text-right`) that means
  // nothing in a card — so the card styles each slot itself.
  mobile?: MobileSlot;
}

//   title    – the card's headline, top left. Its header is not shown, so a cell
//              that already renders a second line (title + reference) keeps it.
//   trailing – the value opposite the title: the amount, or the status.
//   meta     – a label/value line in the card body, labelled by `header`.
//   actions  – buttons, on their own row at the bottom, unlabelled.
//   hide     – left out of the card; the column is desktop-only.
// Unset means `meta`. If no column claims `title` the first one is used, so a
// list that has not been annotated still reads as a card rather than a stack of
// anonymous label/value pairs.
type MobileSlot = "title" | "trailing" | "meta" | "actions" | "hide";

type Controls = TableControlState;

const alignCls = (a?: Column<unknown>["align"]) => a === "right" ? "text-right" : a === "center" ? "text-center" : "text-left";

// Horizontal padding for every header and body cell.
//
// The outer columns take the card's inset so the table's left and right edges
// line up with the toolbar above it and the card around it — they used to be
// 20px against the toolbar's 24px, which put the search field four pixels off
// the first column for no reason anyone could see.
//
// Interior columns take a tighter gutter instead. Uniform 20px padding meant
// 40px of air between one column's text and the next, which is what pushed the
// trailing columns off the screen on a laptop. 12px a side keeps the table
// aligned outside and dense inside — the same reason `md:` is where the table
// appears at all.
const CELL_X = "px-3 first:pl-inset last:pr-inset";

type MobileGroups<T> = {
  title: Column<T> | undefined;
  trailing: Column<T>[];
  meta: Column<T>[];
  actions: Column<T>[];
};

// Split the columns into the card's slots once per column set. `title` falls
// back to the first column so an un-annotated list still has a headline.
function mobileSlots<T>(cols: Column<T>[]): MobileGroups<T> {
  const visible = cols.filter((c) => c.mobile !== "hide");
  const title = visible.find((c) => c.mobile === "title") ?? visible[0];
  return {
    title,
    trailing: visible.filter((c) => c.mobile === "trailing"),
    meta: visible.filter((c) => c !== title && (c.mobile ?? "meta") === "meta"),
    actions: visible.filter((c) => c.mobile === "actions"),
  };
}

// A cell that renders to nothing (an action a row doesn't offer, an empty
// column) would otherwise leave a labelled but blank line in the card.
const isBlank = (node: React.ReactNode) =>
  node == null || node === false || node === "";

// One collator for every sort, rather than an implicit one per comparison.
const collator = new Intl.Collator("sv");

// Compose every active filter — column (text/date), tab and dropdown — into a
// single predicate. Text columns match if any one contains the query; each date
// column must fall within the from/to range; the dropdown's picked options are
// OR-ed; then the tab predicate. A row is kept only if it passes them all.
function buildRowFilter<T>(
  cols: Column<T>[],
  controls: Controls,
  activeTab: TabOption<T> | undefined,
  filter: SelectFilter<T> | undefined,
): (row: T) => boolean {
  const { query, dateFrom: from, dateTo: to } = controls;
  const q = query.trim().toLowerCase();
  const pick = (flag: "searchable" | "dateRange") =>
    cols.flatMap((c) => (c[flag] && c.value ? [c.value] : []));

  const search = q ? pick("searchable") : [];
  const dates = from || to ? pick("dateRange") : [];
  const within = (v: string) => (!from || v >= from) && (!to || v <= to);
  const tabPred = activeTab?.predicate;
  const picked = (filter?.options ?? [])
    .filter((o) => controls.picks.includes(o.value))
    .map((o) => o.predicate);

  return (row) =>
    (!search.length || search.some((v) => String(v(row)).toLowerCase().includes(q))) &&
    dates.every((v) => within(String(v(row)))) &&
    (!picked.length || picked.some((p) => p(row))) &&
    (tabPred?.(row) ?? true);
}

export function DataTable<T>({
  columns,
  rows,
  controls,
  tabs,
  filter,
  searchPlaceholder,
  rowKey,
  rowClassName,
  onRowClick,
  empty,
}: {
  columns: Column<T>[];
  rows: T[];
  // Drives the filter bar, sorting and pagination.
  controls: Controls;
  // Segmented filter; the active option's predicate is applied automatically.
  tabs?: TabFilter<T>;
  // Dropdown filter; the picked options' predicates are OR-ed automatically.
  filter?: SelectFilter<T>;
  searchPlaceholder?: string;
  rowKey: (row: T) => string;
  // Styles the whole row from its data — a retired row dimmed, say. Applies to
  // the phone card as well, so both renderings read the same.
  rowClassName?: (row: T) => string | undefined;
  onRowClick?: (row: T) => void;
  empty?: React.ReactNode;
}) {
  const t = useTranslations("common.table");
  const cols = useMemo(() => columns.filter((c) => !c.hidden), [columns]);
  const slots = useMemo(() => mobileSlots(cols), [cols]);

  // Until a tab is picked (and if a stale value no longer matches an option) the
  // first tab is the active one, so pages don't restate their default.
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

  const pageRows = controls.paginate(data);

  const hasText = cols.some((c) => c.searchable);
  const hasDate = cols.some((c) => c.dateRange);

  return (
    <>
      {(hasText || hasDate || activeTab || filter) && (
        <div className="flex flex-col gap-3 border-b border-border px-inset py-3">
          {tabs && tabs.length > 0 && (
            <SegmentedControl
              options={tabs.map((o) => ({ value: o.value, label: o.label }))}
              value={activeTab?.value ?? ""}
              onChange={controls.setTab}
              size="sm"
            />
          )}
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            {/* Ahead of the search box: it names which slice of the list you're
                looking at, which is the coarser question, and it keeps a fixed
                width while the search takes whatever is left. */}
            {filter && (
              <MultiCombobox
                className="sm:w-52 sm:shrink-0"
                options={filter.options}
                values={controls.picks}
                onChange={controls.setPicks}
                placeholder={filter.label}
                aria-label={filter.label}
              />
            )}

            {hasText && (
              <SearchInput
                className="sm:min-w-48 sm:flex-1"
                value={controls.query}
                placeholder={searchPlaceholder ?? t("searchPlaceholder")}
                onChange={(e) => controls.setQuery(e.target.value)}
              />
            )}

            {hasDate && (
              // The two dates stay on one line together at every width — they
              // read as a range — but share it rather than each claiming 10rem,
              // which is what used to push the bar past a phone's screen.
              <div className="flex min-w-0 items-center gap-2">
                <div className="min-w-0 flex-1 sm:w-40 sm:flex-none">
                  <DateInput
                    size="sm"
                    value={controls.dateFrom}
                    onChange={(e) => controls.setDateFrom(e.target.value)}
                    title={t("dateFromTitle")}
                    placeholder={t("dateFrom")}
                  />
                </div>
                <span className="text-xs text-muted">–</span>
                <div className="min-w-0 flex-1 sm:w-40 sm:flex-none">
                  <DateInput
                    size="sm"
                    value={controls.dateTo}
                    onChange={(e) => controls.setDateTo(e.target.value)}
                    title={t("dateToTitle")}
                    placeholder={t("dateTo")}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {data.length === 0 ? (
        <EmptyNote size="page">{empty ?? t("empty")}</EmptyNote>
      ) : (
        <>
          <div className="divide-y divide-border md:hidden">
            {pageRows.map((row) => (
              <MobileRow
                key={rowKey(row)}
                row={row}
                slots={slots}
                className={rowClassName?.(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
              />
            ))}
          </div>

          {/* Six columns of Swedish resultUnit names add up to more than the card
              is wide until about 1280px, so without this the trailing ones —
              amount, actions — were unreachable rather than merely tight: past
              the card's edge with nothing to scroll. Side-scrolling a list you
              meant to skim is the poor relation of the card rendering above,
              which is why that exists; this is the floor under it, not the
              intended way to read one. */}
          <div className="hidden overflow-x-auto overscroll-x-contain md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs font-medium text-muted">
                  {cols.map((c) =>
                    c.value && c.sortable ? (
                      <SortableHeader
                        key={c.key}
                        sortKey={c.key}
                        controls={controls}
                        className={cn(CELL_X, "py-3", alignCls(c.align), c.className)}
                      >
                        {c.header}
                      </SortableHeader>
                    ) : (
                      <th key={c.key} className={cn(CELL_X, "py-3", alignCls(c.align), c.className)}>
                        {c.header}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {pageRows.map((row) => (
                  <tr
                    key={rowKey(row)}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    className={cn(
                      onRowClick && "cursor-pointer hover:bg-surface/50",
                      rowClassName?.(row),
                    )}
                  >
                    {cols.map((c) => (
                      <td key={c.key} className={cn(CELL_X, "py-4", alignCls(c.align), c.className)}>
                        {c.cell(row)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <Pagination
        page={controls.page}
        onPageChange={controls.setPage}
        pageSize={controls.pageSize}
        onPageSizeChange={controls.setPageSize}
        totalItems={data.length}
      />
    </>
  );
}

// One row as a card: headline and its trailing value on top, the remaining
// columns as label/value lines under a rule, actions last.
function MobileRow<T>({
  row,
  slots,
  className,
  onClick,
}: {
  row: T;
  slots: MobileGroups<T>;
  className?: string;
  onClick?: () => void;
}) {
  const cell = (c: Column<T>) => c.cell(row);
  const meta = slots.meta.map((c) => [c, cell(c)] as const).filter(([, n]) => !isBlank(n));
  const actions = slots.actions.map((c) => [c, cell(c)] as const).filter(([, n]) => !isBlank(n));
  const trailing = slots.trailing.map((c) => [c, cell(c)] as const).filter(([, n]) => !isBlank(n));

  return (
    <div
      onClick={onClick}
      className={cn("px-inset py-4", onClick && "cursor-pointer active:bg-surface/50", className)}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 text-sm">{slots.title && cell(slots.title)}</div>
        {trailing.length > 0 && (
          <div className="flex shrink-0 flex-col items-end gap-1 text-sm font-semibold tabular-nums">
            {trailing.map(([c, node]) => (
              <div key={c.key}>{node}</div>
            ))}
          </div>
        )}
      </div>

      {meta.length > 0 && (
        <dl className="mt-3 space-y-1.5 border-t border-border pt-3">
          {meta.map(([c, node]) => (
            <div key={c.key} className="flex items-baseline justify-between gap-3 text-sm">
              <dt className="shrink-0 text-xs text-muted">{c.header}</dt>
              <dd className="min-w-0 text-right">{node}</dd>
            </div>
          ))}
        </dl>
      )}

      {actions.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
          {actions.map(([c, node]) => (
            <div key={c.key}>{node}</div>
          ))}
        </div>
      )}
    </div>
  );
}
