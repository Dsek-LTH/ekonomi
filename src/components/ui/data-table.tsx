"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/ui/utils";
import { MultiCombobox } from "./combobox";
import { EmptyNote } from "./empty-state";
import { DateInput } from "./field";
import { SearchInput } from "./search-input";
import { IconChevronLeft, IconChevronRight } from "./icons";
import { FilterTabs } from "./filter-tabs";
import { PAGE_SIZES, type PageSize, type ServerControls, type TableControlState } from "@/lib/data/use-list-query";

// The table every data list is drawn with: the filter bar (search / date range
// / tabs, all derived from the column declarations), the header, the rows, and
// the pagination footer. Pages keep their own <Card> wrapper around it.
//
// It renders the page it is given and does not choose it. Filtering, sorting
// and cutting happen in the database, and the address bar is where the choices
// live (lib/data/list-query.ts) — so this takes `rows` already narrowed and
// `controls.total` for the pager to count against.
//
// A list that filters in the browser instead uses ClientDataTable, which wraps
// this one and does that work first. The two used to be one component with a
// `server` boolean, and the boolean silently changed what half the props meant:
// on a server-backed list the `predicate` on a tab was never called, the
// `value` accessors were never compared, and nothing said so. Declaring one was
// not an error, it was just ineffective — which is the kind of thing you find
// by noticing a filter does nothing, months later. Now the two engines are two
// components, and the props each accepts are only the ones it acts on.
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
// column until lg (see components/shell/app-shell.tsx). With a 256px column at
// md the table below inherited under 500px and its trailing columns fell off
// the right edge, which made 768 read worse than 767. If that ever changes
// back, this breakpoint has to move to lg with it.

// A tab (segmented filter). The value is what goes in the URL and what the
// page's query translates into a filter; the first option is the default.
//
// No predicate: what a tab *means* is the database's business here. The
// browser-side variant with predicates is ClientTabOption, in client-data-table.
export type TabOption = { value: string; label: string };

export type TabFilter = TabOption[];

// A dropdown filter over one dimension of the rows, for a dimension with more
// values than a segmented control can carry — status, of which there are seven.
// Several options can be on at once and a row is kept if it matches any of them,
// so the options are OR-ed; none picked means the filter isn't narrowing
// anything. That resting state is why this doesn't replace `tabs`, which always
// has exactly one option in force and reads as a coarse cut of the whole list.
export type SelectFilter = {
  // The trigger's text while nothing is picked — it stands for every row, so
  // say so ("Alla statusar") rather than naming the column.
  label: string;
  options: { value: string; label: string }[];
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

export function DataTable<T>({
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
  empty,
}: {
  columns: Column<T>[];
  /** This page of rows, already narrowed and ordered. */
  rows: T[];
  // Drives the filter bar, the sort indicator and the pager. `ServerControls`
  // specifically: handing this the browser-side `useTableControls` is a
  // compile error rather than a table that silently shows one unfiltered page.
  controls: ServerControls;
  /** Segmented filter. Which rows each value selects is the query's business. */
  tabs?: TabFilter;
  /** Dropdown filter, OR-ed across the picked values. */
  filter?: SelectFilter;
  /**
   * What you can do to this list — "Nytt utlägg", "Importera CSV". At the right
   * end of the toolbar, and the only place in the app a list's own action is
   * put.
   *
   * Here rather than in the page header, where these used to live: a header
   * says what you are looking at, and a create button is not that. It also
   * stopped being true that the header could hold them — one page's header
   * action was a create button, another's was a combobox, a third's was a row
   * of buttons acting on a single object, and one slot holding all three is a
   * slot that means nothing. Next to the search box, it means "this list".
   */
  action?: React.ReactNode;
  searchPlaceholder?: string;
  rowKey: (row: T) => string;
  // Styles the whole row from its data — a retired row dimmed, say. Applies to
  // the phone card as well, so both renderings read the same.
  rowClassName?: (row: T) => string | undefined;
  /**
   * Where a row goes when you open it.
   *
   * This used to be `onRowClick`, a handler on the `<tr>`, and every caller
   * passed the same thing: a `router.push` to a URL. A click handler on a table
   * row is reachable with a mouse and with nothing else — no tab stop, no
   * Enter, no "open in a new tab", and a screen reader announcing the row said
   * nothing about it being openable at all. Every list in the app was mouse-only
   * because of it.
   *
   * Given the address instead, the row's title becomes a real link. The keyboard
   * gets one tab stop per row on a control that says what it is; the mouse keeps
   * the whole row, because that is a nice thing to have and costs nothing once
   * the link underneath is doing the actual work.
   */
  rowHref?: (row: T) => string;
  empty?: React.ReactNode;
}) {
  const t = useTranslations("common.table");
  const cols = useMemo(() => columns.filter((c) => !c.hidden), [columns]);
  const slots = useMemo(() => mobileSlots(cols), [cols]);

  // Until a tab is picked (and if a stale value no longer matches an option) the
  // first tab is the active one, so pages don't restate their default.
  const activeTab = tabs?.find((o) => o.value === controls.tab) ?? tabs?.[0];

  // The rows are the page. Nothing is filtered, sorted or cut here.
  const data = rows;
  const pageRows = rows;
  const totalItems = controls.total;

  const hasText = cols.some((c) => c.searchable);
  const hasDate = cols.some((c) => c.dateRange);

  return (
    <>
      {/* Which slice of the list, on its own hairline at the top of the card —
          the underline register (components/ui/filter-tabs.tsx). Pills here
          used to read exactly like the "Mina / Alla" pills in the page header a
          few pixels above, and those two ask different questions: that one
          changes which collection you are looking at, this one narrows the one
          you are in. */}
      {tabs && tabs.length > 0 && (
        <div className="border-b border-border px-inset">
          <FilterTabs
            options={tabs.map((o) => ({ value: o.value, label: o.label }))}
            value={activeTab?.value ?? ""}
            onChange={controls.setTab}
            aria-label={t("tabsLabel")}
          />
        </div>
      )}

      {(hasText || hasDate || filter || action) && (
        <div className="flex flex-col gap-2 border-b border-border px-inset py-3 sm:flex-row sm:flex-wrap sm:items-center">
          {/* Ahead of the search box: it names which kinds of row you're looking
              at, which is the coarser question, and it keeps a fixed width while
              the search takes whatever is left. */}
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

          {/* Last, and pushed to the far end on a wide screen — the search box
              is what takes the space between. On a phone the bar is a column
              and this is simply the row after the search, which is where a
              button that adds to the list below belongs anyway. */}
          {action && <div className="flex items-center gap-2 sm:ml-auto">{action}</div>}
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
                href={rowHref?.(row)}
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
                {pageRows.map((row) => {
                  const href = rowHref?.(row);
                  return (
                  <tr
                    key={rowKey(row)}
                    className={cn(
                      href && "relative cursor-pointer hover:bg-surface/50",
                      rowClassName?.(row),
                    )}
                  >
                    {cols.map((c) => (
                      <td key={c.key} className={cn(CELL_X, "py-4", alignCls(c.align), c.className)}>
                        {/* The link goes in the title cell and nowhere else:
                            one control per row, on the thing that names it.
                            `before:` stretches its hit area over the whole row,
                            so clicking anywhere still opens it — the mouse
                            behaviour the old row handler had, now provided by
                            the same element the keyboard uses.

                            A cell with a control of its own has to climb over
                            that overlay: `relative z-10` on whatever wraps it.
                            Positioned things at the auto level paint in tree
                            order, so a control *after* this cell is already
                            above it and one *before* it is not — which is why a
                            checkbox in the first column silently stopped being
                            clickable while action buttons in the last never
                            did. See the compare column in
                            app/(app)/budget/budget-list-client.tsx. */}
                        {href && c === slots.title ? (
                          <Link
                            href={href}
                            className="before:absolute before:inset-0 hover:underline focus-visible:underline"
                          >
                            {c.cell(row)}
                          </Link>
                        ) : (
                          c.cell(row)
                        )}
                      </td>
                    ))}
                  </tr>
                  );
                })}
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
        totalItems={totalItems}
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
  href,
}: {
  row: T;
  slots: MobileGroups<T>;
  className?: string;
  /** Where the card goes when opened — see `rowHref`. */
  href?: string;
}) {
  const cell = (c: Column<T>) => c.cell(row);
  const meta = slots.meta.map((c) => [c, cell(c)] as const).filter(([, n]) => !isBlank(n));
  const actions = slots.actions.map((c) => [c, cell(c)] as const).filter(([, n]) => !isBlank(n));
  const trailing = slots.trailing.map((c) => [c, cell(c)] as const).filter(([, n]) => !isBlank(n));

  const title = slots.title && cell(slots.title);
  return (
    <div
      className={cn(
        "px-inset py-4",
        href && "relative cursor-pointer active:bg-surface/50",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 text-sm">
          {/* Same arrangement as the table: the headline is the link, and its
              hit area covers the card. The actions further down sit above it
              (they are later in the stacking order), so a delete button on a
              card is still a delete button and not a navigation. */}
          {href ? (
            <Link href={href} className="before:absolute before:inset-0 hover:underline focus-visible:underline">
              {title}
            </Link>
          ) : (
            title
          )}
        </div>
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
        <div className="relative mt-3 flex flex-wrap items-center justify-end gap-2">
          {actions.map(([c, node]) => (
            <div key={c.key}>{node}</div>
          ))}
        </div>
      )}
    </div>
  );
}

// Sortable table header cell. Renders a <th> with a sort indicator.
export function SortableHeader({
  children,
  sortKey: key,
  controls,
  className,
}: {
  children: React.ReactNode;
  sortKey: string;
  controls: Pick<TableControlState, "sortKey" | "sortDir" | "toggleSort">;
  className?: string;
}) {
  const active = controls.sortKey === key;
  const dir = controls.sortDir === "asc" ? "ascending" : "descending";
  return (
    <th
      // What the column is sorted by, in the one attribute assistive tech reads
      // for it. Without this a screen reader user could reorder a table and be
      // told nothing about what had changed — or that it was sortable at all.
      aria-sort={active ? dir : "none"}
      className={cn("select-none whitespace-nowrap", className)}
    >
      {/* The control is a button, not the cell. A <th> with an onClick is
          reachable by mouse alone: no tab stop, no Enter, no announcement. */}
      <button
        type="button"
        onClick={() => controls.toggleSort(key)}
        className="inline-flex cursor-pointer items-center whitespace-nowrap"
      >
        {children}
        {/* Decoration. It is the arrow for the *current* direction whether or
            not this column is the sorted one — hidden with `text-transparent`
            so the header keeps its width — which means it is a lie on every
            other column and must not be read out. `aria-sort` above is what
            actually carries this to a reader. */}
        <span
          aria-hidden="true"
          className={cn("ml-1 text-[10px]", active ? "text-accent" : "text-transparent")}
        >
          {controls.sortDir === "asc" ? "▲" : "▼"}
        </span>
      </button>
    </th>
  );
}

// Pagination footer — rendered by DataTable after the list.
export function Pagination({
  page,
  onPageChange,
  pageSize,
  onPageSizeChange,
  totalItems,
}: {
  page: number;
  onPageChange: (n: number) => void;
  pageSize: PageSize;
  onPageSizeChange: (n: PageSize) => void;
  totalItems: number;
}) {
  const t = useTranslations("common.table");
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const from = totalItems === 0 ? 0 : page * pageSize + 1;
  const to = Math.min((page + 1) * pageSize, totalItems);

  const select = "h-8 rounded-lg border border-border bg-background px-2 text-sm";
  const btn = "flex size-8 items-center justify-center rounded-lg border border-border bg-background text-sm transition-colors hover:bg-surface disabled:opacity-40 disabled:pointer-events-none";

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border px-inset py-3">
      <p className="text-xs text-muted">
        {totalItems === 0 ? t("noResults") : t("showing", { from, to, total: totalItems })}
      </p>
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1.5 text-xs text-muted">
          {/* On a phone the select and the arrows are what matter; the words
              around them are the first thing to give up the width. */}
          <span className="hidden sm:inline">{t("show")}</span>
          <select
            value={pageSize}
            // The visible label is gone below sm, so the select carries its own.
            aria-label={`${t("show")} ${t("perPage")}`}
            onChange={(e) => onPageSizeChange(Number(e.target.value) as PageSize)}
            className={select}
          >
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
          <span className="hidden sm:inline">{t("perPage")}</span>
        </label>
        <button
          className={btn}
          disabled={page === 0}
          onClick={() => onPageChange(page - 1)}
          aria-label={t("prevPage")}
        >
          <IconChevronLeft className="size-4" />
        </button>
        <button
          className={btn}
          disabled={page >= totalPages - 1}
          onClick={() => onPageChange(page + 1)}
          aria-label={t("nextPage")}
        >
          <IconChevronRight className="size-4" />
        </button>
      </div>
    </div>
  );
}
