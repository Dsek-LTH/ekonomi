"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/ui/utils";
import { Combobox, MultiCombobox } from "./combobox";
import { EmptyNote } from "./empty-state";
import { DateInput, FieldGroup } from "./field";
import { SearchInput } from "./search-input";
import { IconChevronLeft, IconChevronRight, IconFilter } from "./icons";
import { FilterTabs } from "./filter-tabs";
import { Button } from "./button";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "./modal";
import {
  PAGE_SIZES,
  type PageSize,
  type ServerControls,
  type TableControlState,
} from "@/lib/data/use-list-query";

// md is where the sidebar becomes a 64px rail (components/shell/app-shell.tsx) and rows become phone cards. Move both together.

// A tab (segmented filter). The value goes in the URL; the first option is the default.
export type TabOption = {
  value: string;
  label: string;
  badge?: number;
  /** Count is work waiting on the reader (drawn pink), otherwise a grey tally. */
  waiting?: boolean;
};

export type TabFilter = TabOption[];

// A dropdown filter over one dimension. Picked options are OR-ed; none picked means no narrowing (unlike `tabs`).
export type SelectFilter = {
  label: string;
  options: { value: string; label: string }[];
};

/** Several dropdowns along different dimensions. They share one `picks` list, so option values must be unique across them. OR-ed within a filter, AND-ed across. */
export type SelectFilters = SelectFilter | SelectFilter[];

const asFilters = (filter: SelectFilters | undefined): SelectFilter[] =>
  filter ? (Array.isArray(filter) ? filter : [filter]) : [];

/** One dropdown over the part of `picks` that belongs to it; a change replaces only those. */
function FilterPicker({
  filter,
  controls,
  size,
  className,
}: {
  filter: SelectFilter;
  controls: TableControlState;
  size?: "sm" | "md";
  className?: string;
}) {
  const own = new Set(filter.options.map((o) => o.value));
  return (
    <MultiCombobox
      size={size}
      className={className}
      options={filter.options}
      values={controls.picks.filter((v) => own.has(v))}
      onChange={(next) =>
        controls.setPicks([...controls.picks.filter((v) => !own.has(v)), ...next])
      }
      placeholder={filter.label}
      aria-label={filter.label}
    />
  );
}

export interface Column<T> {
  key: string;
  header: React.ReactNode;
  cell: (row: T) => React.ReactNode;
  // Comparable value; the flags below opt it into sorting, search and date filtering.
  value?: (row: T) => string | number;
  sortable?: boolean;
  searchable?: boolean;
  dateRange?: boolean;
  align?: "left" | "right" | "center";
  className?: string; // extra classes applied to both <th> and <td>
  hidden?: boolean; // drop the column entirely (e.g. role-dependent)
  // Where the column lands in the phone card. `className` is not applied there (table geometry).
  mobile?: MobileSlot;
  /** Order within its phone slot: lower first, unset is 0. */
  mobileOrder?: number;
  /** What the column shows on a phone where that differs from `cell`. */
  mobileCell?: (row: T) => React.ReactNode;
}

//   title    - what the row is. One column.
//   trailing - the figure opposite it, usually the amount. One column.
//   meta     - who or what, and when: at most two columns, joined by a comma
//              into the muted second line. The header is announced to a screen
//              reader and shown to nobody, so a cell here has to read on its
//              own: "24 st", not "24".
//   status   - a tag opposite the second line. One column.
//   actions  - a button at the right-hand end, for the one thing a row is
//              waiting on ("Redovisa"). Rarely more than one.
//   hide     - not on a phone. The default: everything else is on the page the
//              row opens, or in the table on a wider screen.
// Unset means hide. If no column claims title, the first one is used.
type MobileSlot = "title" | "trailing" | "meta" | "status" | "actions" | "hide";

const alignCls = (a?: Column<unknown>["align"]) =>
  a === "right" ? "text-right" : a === "center" ? "text-center" : "text-left";

// Outer columns take the card's inset so edges line up with the toolbar; interior columns take a tighter 12px gutter.
const CELL_X = "px-2.5 first:pl-inset last:pr-inset";

type MobileGroups<T> = {
  title: Column<T> | undefined;
  trailing: Column<T>[];
  meta: Column<T>[];
  status: Column<T>[];
  actions: Column<T>[];
};

function mobileSlots<T>(cols: Column<T>[]): MobileGroups<T> {
  const visible = cols.filter((c) => c.mobile && c.mobile !== "hide");
  const title = visible.find((c) => c.mobile === "title") ?? cols.find((c) => c.mobile !== "hide");
  const inSlot = (slot: MobileSlot) =>
    visible
      .filter((c) => c !== title && c.mobile === slot)
      .sort((a, b) => (a.mobileOrder ?? 0) - (b.mobileOrder ?? 0));
  return {
    title,
    trailing: inSlot("trailing"),
    meta: inSlot("meta"),
    status: inSlot("status"),
    actions: inSlot("actions"),
  };
}

// A cell that renders nothing would leave a labelled blank line in the card.
const isBlank = (node: React.ReactNode) => node == null || node === false || node === "";

export function DataTable<T>({
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
  rowScroll = true,
  expansion,
  expandAll,
  empty,
}: {
  columns: Column<T>[];
  rows: T[];
  // ServerControls specifically: the browser-side useTableControls is a compile error here.
  controls: ServerControls;
  tabs?: TabFilter;
  filter?: SelectFilters;
  /** A figure about the whole list (e.g. "Lagervärde 48 312 kr"), at the end of the tab row or toolbar. Never an action: those go in `action`. */
  summary?: React.ReactNode;
  /** The list's own action ("Nytt utlägg"), at the right end of the toolbar. The only place a list's action goes. */
  action?: React.ReactNode;
  /** What `action` opened in place, drawn under the toolbar. */
  actionPanel?: React.ReactNode;
  searchPlaceholder?: string;
  rowKey: (row: T) => string;
  rowClassName?: (row: T) => string | undefined;
  /** Where a row goes when opened: the title becomes a real link (keyboard, new tab) and the whole row stays clickable. */
  rowHref?: (row: T) => string;
  /** Whether following a row's link scrolls to the top. Off for rows that open a panel beside the list. */
  rowScroll?: boolean;
  /** What sits under a row when opened. A row returning nothing gets no chevron. */
  expansion?: (row: T) => React.ReactNode;
  expandAll?: boolean;
  /** A string, not a node: the table wraps it in an EmptyNote, and a <p> inside <p> breaks hydration. */
  empty?: string;
}) {
  const t = useTranslations("common.table");
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const toggle = (key: string) =>
    setOpened((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  const cols = useMemo(() => columns.filter((c) => !c.hidden), [columns]);
  const slots = useMemo(() => mobileSlots(cols), [cols]);

  const activeTab = tabs?.find((o) => o.value === controls.tab) ?? tabs?.[0];

  const data = rows;
  const pageRows = rows;
  const totalItems = controls.total;

  const hasText = cols.some((c) => c.searchable);
  const hasTabs = !!tabs && tabs.length > 0;
  const toolbarSummary = !hasTabs && !!summary;
  const hasDate = cols.some((c) => c.dateRange);

  // Below sm the narrowing folds into one button with a count badge (so a forgotten filter stays visible); the search stays out. From sm the controls sit in the row.
  const [filtering, setFiltering] = useState(false);
  const filters = asFilters(filter);
  const activeFilters =
    controls.picks.length + (controls.dateFrom ? 1 : 0) + (controls.dateTo ? 1 : 0);

  const head = (
    <thead>
      <tr className="border-b border-border text-left text-xs font-medium text-muted">
        {cols.map((c) =>
          c.value && c.sortable ? (
            <SortableHeader
              key={c.key}
              sortKey={c.key}
              controls={controls}
              className={cn(CELL_X, "py-2 font-medium", alignCls(c.align), c.className)}
            >
              {c.header}
            </SortableHeader>
          ) : (
            <th
              key={c.key}
              className={cn(CELL_X, "py-2 font-medium", alignCls(c.align), c.className)}
            >
              {c.header}
            </th>
          ),
        )}
      </tr>
    </thead>
  );

  return (
    <>
      {hasTabs && (
        // items-end: the active tab's underline is the row's bottom border.
        <div className="flex flex-wrap items-end justify-between gap-x-4 border-b border-border px-inset">
          <div className="min-w-0" data-tour="stage-tabs">
            <FilterTabs
              options={tabs.map((o) => ({
                value: o.value,
                label: o.label,
                badge: o.badge,
                waiting: o.waiting,
              }))}
              value={activeTab?.value ?? ""}
              onChange={controls.setTab}
              aria-label={t("tabsLabel")}
            />
          </div>
          {summary && (
            <div className="flex items-center gap-2 self-center py-1 text-sm">{summary}</div>
          )}
        </div>
      )}

      {(hasText || hasDate || filters.length > 0 || toolbarSummary || action) && (
        <div className="flex flex-col gap-2 border-b border-border px-inset py-3 sm:flex-row sm:flex-wrap sm:items-center">
          {/* sm:contents: below sm one row with the trigger and search; from sm it dissolves. */}
          <div className="flex min-w-0 items-center gap-2 sm:contents">
            {filters.map((f) => (
              <FilterPicker
                key={f.label}
                filter={f}
                controls={controls}
                size="sm"
                className="hidden sm:block sm:w-52 sm:shrink-0"
              />
            ))}

            {(filters.length > 0 || hasDate) && (
              <button
                type="button"
                onClick={() => setFiltering(true)}
                aria-label={t("filters")}
                title={t("filters")}
                className={cn(
                  "flex h-11 shrink-0 items-center gap-1.5 rounded-control border px-3 text-sm font-medium transition-colors sm:hidden",
                  activeFilters > 0
                    ? "border-accent bg-accent-soft text-accent"
                    : "border-border bg-background text-muted",
                )}
              >
                <IconFilter className="size-4" />
                {activeFilters > 0 && <span className="tabular-nums">{activeFilters}</span>}
              </button>
            )}

            {hasText && (
              <SearchInput
                className="min-w-0 flex-1 sm:min-w-48 sm:flex-1"
                value={controls.query}
                placeholder={searchPlaceholder ?? t("searchPlaceholder")}
                onChange={(e) => controls.setQuery(e.target.value)}
              />
            )}
          </div>

          {hasDate && (
            // The two dates stay on one line at every width and share it rather than each claiming 10rem.
            <div className="hidden min-w-0 items-center gap-2 sm:flex">
              <div className="min-w-0 flex-1 sm:w-40 sm:flex-none">
                <DateInput
                  size="sm"
                  value={controls.dateFrom}
                  onChange={(e) => controls.setDateFrom(e.target.value)}
                  title={t("dateFromTitle")}
                  placeholder={t("dateFrom")}
                />
              </div>
              <span className="text-xs text-muted">-</span>
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

          {/* [&>*]: reaches whatever the caller passed (Button, link, Menu wrapper). On a phone the action fills its own row. */}
          {toolbarSummary && (
            <div className="flex min-w-0 items-center gap-2 text-sm sm:ml-auto">{summary}</div>
          )}
          {action && (
            <div
              data-tour="list-action"
              className={cn(
                "flex items-center gap-2 [&>*]:flex-1 sm:[&>*]:flex-none",
                !toolbarSummary && "sm:ml-auto",
              )}
            >
              {action}
            </div>
          )}
        </div>
      )}

      {actionPanel && (
        <div className="border-b border-border bg-surface px-inset py-4">{actionPanel}</div>
      )}

      {filtering && (
        <Modal label={t("filters")} onClose={() => setFiltering(false)} className="max-w-md">
          <ModalHeader title={t("filters")} />
          <ModalBody>
            {filters.map((f) => (
              <FieldGroup key={f.label} label={f.label}>
                <FilterPicker filter={f} controls={controls} />
              </FieldGroup>
            ))}
            {hasDate && (
              <FieldGroup label={t("dateRange")}>
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <DateInput
                      value={controls.dateFrom}
                      onChange={(e) => controls.setDateFrom(e.target.value)}
                      aria-label={t("dateFromTitle")}
                      placeholder={t("dateFrom")}
                    />
                  </div>
                  <span className="text-xs text-muted">-</span>
                  <div className="min-w-0 flex-1">
                    <DateInput
                      value={controls.dateTo}
                      onChange={(e) => controls.setDateTo(e.target.value)}
                      aria-label={t("dateToTitle")}
                      placeholder={t("dateTo")}
                    />
                  </div>
                </div>
              </FieldGroup>
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="ghost" onClick={controls.clearFilters} disabled={activeFilters === 0}>
              {t("clearFilters")}
            </Button>
            <Button onClick={() => setFiltering(false)}>{t("filtersDone")}</Button>
          </ModalFooter>
        </Modal>
      )}

      {data.length === 0 ? (
        // An empty list keeps its heads; on a phone the note stands alone.
        <>
          <EmptyNote size="page" className="md:hidden">
            {empty ?? t("empty")}
          </EmptyNote>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              {head}
              <tbody>
                <tr>
                  <td colSpan={cols.length}>
                    <EmptyNote size="page">{empty ?? t("empty")}</EmptyNote>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <>
          <div className="divide-y divide-border md:hidden">
            {pageRows.map((row) => {
              const key = rowKey(row);
              const under = expansion?.(row);
              const open = Boolean(under) && (expandAll || opened.has(key));
              return (
                <div key={key}>
                  <MobileRow
                    row={row}
                    slots={slots}
                    className={rowClassName?.(row)}
                    href={rowHref?.(row)}
                    scroll={rowScroll}
                  />
                  {under && (
                    <button
                      type="button"
                      onClick={() => toggle(key)}
                      aria-expanded={open}
                      className="flex w-full items-center gap-1.5 px-inset pb-3 text-xs text-muted"
                    >
                      <IconChevronRight
                        className={cn("size-3.5 transition-transform", open && "rotate-90")}
                      />
                      {t("expand")}
                    </button>
                  )}
                  {open && <div className="px-inset pb-3">{under}</div>}
                </div>
              );
            })}
          </div>

          {/* Side scroll is the floor under the card rendering: six columns of unit names exceed the card until about 1280px. */}
          <div className="hidden overflow-x-auto overscroll-x-contain md:block">
            <table className="w-full text-sm">
              {head}
              <tbody className="divide-y divide-border">
                {pageRows.map((row) => {
                  const href = rowHref?.(row);
                  const key = rowKey(row);
                  const under = expansion?.(row);
                  const open = Boolean(under) && (expandAll || opened.has(key));
                  return (
                    <Fragment key={key}>
                      {/* [transform:translate(0)] next to relative: WebKit computes position:relative on a table row as static (bug 240961), so the before: overlay would size against the document.
                      The transform makes a containing block in every engine. Safe because everything floating out of a row is portalled to <body>. */}
                      <tr
                        className={cn(
                          href && "relative cursor-pointer hover:bg-hover [transform:translate(0)]",
                          rowClassName?.(row),
                        )}
                      >
                        {cols.map((c) => (
                          <td
                            key={c.key}
                            className={cn(CELL_X, "py-2", alignCls(c.align), c.className)}
                          >
                            {/* The link goes in the title cell only; before: stretches its hit area over the row. A cell with its own control needs relative z-10 to climb over that overlay (see budget-list-client.tsx). */}
                            {href && c === slots.title ? (
                              <Link
                                href={href}
                                scroll={rowScroll}
                                className="before:absolute before:inset-0 hover:underline focus-visible:underline"
                              >
                                {c.cell(row)}
                              </Link>
                            ) : c === slots.title && under ? (
                              <span className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => toggle(key)}
                                  aria-expanded={open}
                                  className="relative z-10 -ml-1 shrink-0 rounded-control p-0.5 text-muted hover:bg-hover hover:text-foreground"
                                >
                                  <IconChevronRight
                                    className={cn(
                                      "size-3.5 transition-transform",
                                      open && "rotate-90",
                                    )}
                                  />
                                  <span className="sr-only">{t("expand")}</span>
                                </button>
                                {c.cell(row)}
                              </span>
                            ) : (
                              c.cell(row)
                            )}
                          </td>
                        ))}
                      </tr>
                      {open && (
                        <tr className="bg-surface">
                          <td colSpan={cols.length} className={cn(CELL_X, "py-0")}>
                            {under}
                          </td>
                        </tr>
                      )}
                    </Fragment>
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

/** One row on a phone: headline and figure on the first line, who/when and status on the second (see MobileSlot). */
function MobileRow<T>({
  row,
  slots,
  className,
  href,
  scroll = true,
}: {
  row: T;
  slots: MobileGroups<T>;
  className?: string;
  href?: string;
  scroll?: boolean;
}) {
  const cell = (c: Column<T>) => (c.mobileCell ?? c.cell)(row);
  const filled = (cols: Column<T>[]) =>
    cols.map((c) => [c, cell(c)] as const).filter(([, n]) => !isBlank(n));
  const meta = filled(slots.meta);
  const status = filled(slots.status);
  const actions = filled(slots.actions);
  const trailing = filled(slots.trailing);

  const title = slots.title && cell(slots.title);
  return (
    <div
      className={cn(
        // min-h, not a height: a long headline may wrap.
        "flex min-h-16 items-center gap-3 px-inset py-3",
        href && "relative cursor-pointer active:bg-surface",
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-3">
          {/* The headline is the link and covers the row; actions sit above it (later stacking). */}
          <div className="min-w-0 flex-1 truncate text-sm font-medium *:truncate">
            {href ? (
              <Link href={href} scroll={scroll} className="before:absolute before:inset-0">
                {title}
              </Link>
            ) : (
              title
            )}
          </div>
          {trailing.map(([c, node]) => (
            <div key={c.key} className="shrink-0 text-sm font-semibold tabular-nums">
              {node}
            </div>
          ))}
        </div>

        {(meta.length > 0 || status.length > 0) && (
          <div className="mt-1 flex items-center gap-3">
            {/* One line with ellipsis. relative so the sr-only labels are clipped here. A <div>, not <p>: a cell may render a block. */}
            <div className="relative min-w-0 flex-1 truncate text-xs text-muted">
              {meta.map(([c, node], i) => (
                <span key={c.key}>
                  {i > 0 && ", "}
                  <span className="sr-only">{c.header}: </span>
                  {node}
                </span>
              ))}
            </div>
            {status.map(([c, node]) => (
              <div key={c.key} className="shrink-0">
                {node}
              </div>
            ))}
          </div>
        )}
      </div>

      {actions.length > 0 && (
        <div className="relative flex shrink-0 items-center gap-1">
          {actions.map(([c, node]) => (
            <div key={c.key}>{node}</div>
          ))}
        </div>
      )}

      {/* A phone has no hover to show this opens; dropped where the row has actions. */}
      {href && actions.length === 0 && (
        <IconChevronRight aria-hidden className="size-4 shrink-0 text-faint" />
      )}
    </div>
  );
}

function SortableHeader({
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
      aria-sort={active ? dir : "none"}
      className={cn("select-none whitespace-nowrap", className)}
    >
      {/* A button, not the cell: a <th> with onClick has no tab stop or Enter. */}
      <button
        type="button"
        onClick={() => controls.toggleSort(key)}
        className="inline-flex cursor-pointer items-center whitespace-nowrap"
      >
        {children}
        {/* Decoration, transparent on unsorted columns to keep width; aria-sort carries the meaning. */}
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

function Pagination({
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

  const btn =
    "flex size-8 items-center justify-center rounded-control border border-border-control bg-background text-sm transition-colors hover:bg-hover disabled:opacity-40 disabled:pointer-events-none";

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border px-inset py-3">
      <p className="text-xs text-muted">
        {totalItems === 0 ? t("noResults") : t("showing", { from, to, total: totalItems })}
      </p>
      <div className="flex items-center gap-2">
        {/* The app's own picker, not a bare <select>. Not searchable: typing to choose between four numbers is more work than the menu. */}
        <span className="flex items-center gap-1.5 text-xs text-muted">
          <span className="hidden sm:inline">{t("show")}</span>
          <Combobox
            size="sm"
            searchable={false}
            // An explicit width: the trigger is w-full of this wrapper and has nothing to size against.
            className="w-24"
            aria-label={`${t("show")} ${t("perPage")}`}
            value={String(pageSize)}
            options={PAGE_SIZES.map((n) => ({ value: String(n), label: String(n) }))}
            onChange={(v) => onPageSizeChange(Number(v) as PageSize)}
          />
          <span className="hidden sm:inline">{t("perPage")}</span>
        </span>
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
