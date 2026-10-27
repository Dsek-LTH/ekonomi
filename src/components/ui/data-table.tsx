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
import { PAGE_SIZES, type PageSize, type ServerControls, type TableControlState } from "@/lib/data/use-list-query";

// The table every data list is drawn with: the filter bar (search / date range
// / tabs, all derived from the column declarations), the header, the rows, and
// the pagination footer. Pages keep their own <Card> wrapper around it.
//
// It renders the page it is given and does not choose it. Filtering, sorting
// and cutting happen in the database, and the address bar is where the choices
// live (lib/data/list-query.ts), so this takes `rows` already narrowed and
// `controls.total` for the pager to count against.
//
// A list that filters in the browser instead uses ClientDataTable, which wraps
// this one and does that work first. The two used to be one component with a
// `server` boolean, and the boolean silently changed what half the props meant:
// on a server-backed list the `predicate` on a tab was never called, the
// `value` accessors were never compared, and nothing said so. Declaring one was
// not an error, it was just ineffective, which is the kind of thing you find
// by noticing a filter does nothing, months later. Now the two engines are two
// components, and the props each accepts are only the ones it acts on.
//
// Below md a row is drawn as a stacked card instead of a table row: five to
// seven columns cannot be read on a phone, and side-scrolling a list you are
// meant to skim is worse than not showing it. Each column says where it lands in
// that card via `mobile` (see below); the filtering, sorting and pagination
// above are shared, so both renderings always show the same rows. md is the
// breakpoint the sidebar already switches at, one "this is a small screen" line
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
export type TabOption = {
  value: string;
  label: string;
  /** A count beside the label, drawn by FilterTabs. Left out, none is shown. */
  badge?: number;
};

export type TabFilter = TabOption[];

// A dropdown filter over one dimension of the rows, for a dimension with more
// values than a segmented control can carry, such as status, of which there are seven.
// Several options can be on at once and a row is kept if it matches any of them,
// so the options are OR-ed; none picked means the filter isn't narrowing
// anything. That resting state is why this doesn't replace `tabs`, which always
// has exactly one option in force and reads as a coarse cut of the whole list.
export type SelectFilter = {
  // The trigger's text while nothing is picked. It stands for every row, so
  // say so ("Alla statusar") rather than naming the column.
  label: string;
  options: { value: string; label: string }[];
};

/**
 * More than one of them, where a list is narrowed along two dimensions at once
 * (the stock is: what kind of drink, and what the shelf has labelled it).
 *
 * They share one `picks` list, so every option value has to be unique across
 * the filters given here, which is the caller's business to arrange and is why
 * the stock list prefixes its own ("cat:OL", "tag:whisky"). Within a filter the
 * picked options are OR-ed, as one filter always was; across filters they are
 * AND-ed, because two dimensions asked about at once is a narrowing and not a
 * widening.
 */
export type SelectFilters = SelectFilter | SelectFilter[];

/** Either spelling, as a list. */
export const asFilters = (filter: SelectFilters | undefined): SelectFilter[] =>
  filter ? (Array.isArray(filter) ? filter : [filter]) : [];

/**
 * One dropdown, over the part of `picks` that belongs to it.
 *
 * The picks are one flat list, in the state and in the URL, because that is
 * what a filter's values were when there was only ever one of them and it is
 * still what reads best in an address. So each dropdown shows the picks that
 * are its own options and, on a change, replaces exactly those and leaves every
 * other filter's alone.
 */
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
      onChange={(next) => controls.setPicks([...controls.picks.filter((v) => !own.has(v)), ...next])}
      placeholder={filter.label}
      aria-label={filter.label}
    />
  );
}

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
  // applied there, because it carries table geometry (`w-44`, `text-right`) that
  // means nothing in a card, so the card styles each slot itself.
  mobile?: MobileSlot;
  /**
   * Where this column sits among the others in its phone slot. Lower first,
   * unset is 0, and equal values keep the order the columns are declared in.
   * Only needed where `meta` holds two columns and the table's own order is
   * the wrong one for the sentence they make.
   */
  mobileOrder?: number;
  /**
   * What the column shows on a phone, where that differs from `cell`. For a
   * cell that is two lines or a control in the table and has to be a few words
   * in the row's second line: a card holder's name without the card number
   * under it.
   */
  mobileCell?: (row: T) => React.ReactNode;
}

// A row on a phone has one shape, whatever the table:
//
//   title     trailing        Kaffe till pubben           1 240 kr
//   meta      status          Maja Holm, 12 okt            [Väntar]
//
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
//
// Unset means `hide`. It meant `meta`, and every column a table had not thought
// about ran together into the second line, eight things to a line with nothing
// to say which was which. A table now says what its phone row holds, and a
// column added later stays off it until somebody decides it belongs. If no
// column claims `title` the first one is used, so a row always has a headline.
type MobileSlot = "title" | "trailing" | "meta" | "status" | "actions" | "hide";

const alignCls = (a?: Column<unknown>["align"]) => a === "right" ? "text-right" : a === "center" ? "text-center" : "text-left";

// Horizontal padding for every header and body cell.
//
// The outer columns take the card's inset so the table's left and right edges
// line up with the toolbar above it and the card around it. They used to be
// 20px against the toolbar's 24px, which put the search field four pixels off
// the first column for no reason anyone could see.
//
// Interior columns take a tighter gutter instead. Uniform 20px padding meant
// 40px of air between one column's text and the next, which is what pushed the
// trailing columns off the screen on a laptop. 12px a side keeps the table
// aligned outside and dense inside, for the same reason `md:` is where the table
// appears at all.
const CELL_X = "px-3 first:pl-inset last:pr-inset";

type MobileGroups<T> = {
  title: Column<T> | undefined;
  trailing: Column<T>[];
  meta: Column<T>[];
  status: Column<T>[];
  actions: Column<T>[];
};

// Split the columns into the card's slots once per column set. `title` falls
// back to the first column so an un-annotated list still has a headline.
function mobileSlots<T>(cols: Column<T>[]): MobileGroups<T> {
  const visible = cols.filter((c) => c.mobile && c.mobile !== "hide");
  const title =
    visible.find((c) => c.mobile === "title") ?? cols.find((c) => c.mobile !== "hide");
  // Sort is stable, so a slot where nobody has an opinion keeps the order the
  // columns were declared in, which is what every slot but one relies on.
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
  summary,
  action,
  actionPanel,
  searchPlaceholder,
  rowKey,
  rowClassName,
  rowHref,
  expansion,
  expandAll,
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
  /** Dropdown filter, OR-ed across the picked values. Several of them narrow
   *  along several dimensions at once; see SelectFilters. */
  filter?: SelectFilters;
  /**
   * A figure about the whole list, the sum of one of its columns: the stock
   * list's "Lagervärde 48 312 kr". At the right end of the tab row, which is
   * text like it and otherwise empty on that side: which slice you are looking
   * at on the left, what it is worth on the right. A table without tabs puts
   * it at the end of the toolbar instead. Not among the toolbar's buttons when
   * there is a choice: plain text in a row of controls reads as a label that
   * lost its field.
   *
   * A figure, and whatever belongs to that figure (a button that recomputes
   * it). Never an action on the list: those go in `action`, whose rule is
   * spelled out below.
   */
  summary?: React.ReactNode;
  /**
   * What you can do to this list: "Nytt utlägg", "Importera CSV". At the right
   * end of the toolbar, and the only place in the app a list's own action is
   * put.
   *
   * Here rather than in the page header, where these used to live: a header
   * says what you are looking at, and a create button is not that. It also
   * stopped being true that the header could hold them. One page's header
   * action was a create button, another's was a combobox, a third's was a row
   * of buttons acting on a single object, and one slot holding all three is a
   * slot that means nothing. Next to the search box, it means "this list".
   */
  action?: React.ReactNode;
  /**
   * What `action` opened, when it opens in place: a short form for a new row,
   * say. Drawn straight under the toolbar, so it appears below the button that
   * asked for it rather than somewhere above it, and above the rows it will
   * add to.
   */
  actionPanel?: React.ReactNode;
  searchPlaceholder?: string;
  rowKey: (row: T) => string;
  // Styles the whole row from its data, a retired row dimmed, say. Applies to
  // the phone card as well, so both renderings read the same.
  rowClassName?: (row: T) => string | undefined;
  /**
   * Where a row goes when you open it.
   *
   * This used to be `onRowClick`, a handler on the `<tr>`, and every caller
   * passed the same thing: a `router.push` to a URL. A click handler on a table
   * row is reachable with a mouse and with nothing else: no tab stop, no
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
  /**
   * What sits underneath a row when it is opened, or nothing for a row with
   * nothing behind it.
   *
   * For a row that *stands for* several, such as a stock movement and the corrections
   * that got it to its figure. The list stays one line per thing that happened,
   * and what is behind a line is a chevron away rather than another six lines
   * everybody has to read past. A row that returns nothing here gets no
   * chevron, so the control appears exactly where there is something to see.
   */
  expansion?: (row: T) => React.ReactNode;
  /** Open every expandable row. For a "show everything" switch above the list. */
  expandAll?: boolean;
  /**
   * What to say when there is nothing to show. A string, not a node: the table
   * wraps it in an `EmptyNote` itself, and six callers each passed a second one
   * in, so `<p>` inside `<p>`, which the browser unpicks and hydration then finds
   * a tree it did not build. The type is what stops the seventh.
   */
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

  // Until a tab is picked (and if a stale value no longer matches an option) the
  // first tab is the active one, so pages don't restate their default.
  const activeTab = tabs?.find((o) => o.value === controls.tab) ?? tabs?.[0];

  // The rows are the page. Nothing is filtered, sorted or cut here.
  const data = rows;
  const pageRows = rows;
  const totalItems = controls.total;

  const hasText = cols.some((c) => c.searchable);
  // Where `summary` goes: the tab row when there is one, the toolbar otherwise.
  const hasTabs = !!tabs && tabs.length > 0;
  const toolbarSummary = !hasTabs && !!summary;
  const hasDate = cols.some((c) => c.dateRange);

  // ── The toolbar on a phone ──
  //
  // Below sm the bar was a column, and every control in it claimed a row of its
  // own: a filter, a search box, a date range and an action came to about 196px
  // of toolbar under a card header, before a single row of data. On a 393pt
  // screen that is most of what you can see spent on the means of narrowing a
  // list you cannot yet read.
  //
  // So the narrowing folds into one button and the row it opens. The search
  // stays out, because it is the one that is used without being thought about;
  // everything else is set once and then read off the badge. The badge is the
  // whole reason this is safe. A filter you cannot see is a filter you forget
  // is on, and a list quietly missing rows is worse than a tall toolbar.
  //
  // From sm nothing here applies: the controls sit in the row as they always
  // did, and the trigger is not rendered.
  const [filtering, setFiltering] = useState(false);
  const filters = asFilters(filter);
  const activeFilters =
    controls.picks.length + (controls.dateFrom ? 1 : 0) + (controls.dateTo ? 1 : 0);

  return (
    <>
      {/* Which slice of the list, on its own hairline at the top of the card,
          the underline register (components/ui/filter-tabs.tsx). Pills here
          used to read exactly like the "Mina / Alla" pills in the page header a
          few pixels above, and those two ask different questions: that one
          changes which collection you are looking at, this one narrows the one
          you are in. */}
      {hasTabs && (
        // `items-end`: the active tab's underline is drawn on this row's bottom
        // border, so the tabs keep to the bottom whatever height the summary
        // brings, and the summary centres itself in what is left.
        <div className="flex flex-wrap items-end justify-between gap-x-4 border-b border-border px-inset">
          <div className="min-w-0">
            <FilterTabs
              options={tabs.map((o) => ({ value: o.value, label: o.label, badge: o.badge }))}
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
          {/* `sm:contents`. Below sm this is one row holding the trigger and
              the search; from sm it dissolves and its children take their own
              places in the toolbar, in the order they are written. Which is how
              the wide layout stays exactly what it was while the narrow one is
              something else entirely. */}
          <div className="flex min-w-0 items-center gap-2 sm:contents">
            {/* Ahead of the search box: it names which kinds of row you're
                looking at, which is the coarser question, and it keeps a fixed
                width while the search takes whatever is left. */}
            {filters.map((f) => (
              <FilterPicker
                key={f.label}
                filter={f}
                controls={controls}
                // The toolbar is the compact register: sm, like the date
                // inputs beside it.
                size="sm"
                className="hidden sm:block sm:w-52 sm:shrink-0"
              />
            ))}

            {/* What the two of them become on a phone. Icon and count only,
                because the word would be the widest thing in a row whose whole point is
                giving the width to the search box. */}
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
                {activeFilters > 0 && (
                  <span className="tabular-nums">{activeFilters}</span>
                )}
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
            // The two dates stay on one line together at every width, since they
            // read as a range, but share it rather than each claiming 10rem,
            // which is what used to push the bar past a phone's screen.
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

          {/* Last, and pushed to the far end on a wide screen. The search box
              is what takes the space between.

              On a phone it is a row of its own and it fills it. A button that
              adds to the list below is the page's primary action, and a primary
              action sitting a third of the way across an otherwise empty row
              reads as something that failed to lay out rather than something
              somebody placed. `[&>*]:` reaches whatever the caller passed (a
              Button, a link, a Menu's wrapper) because a toolbar cannot know
              which of those it was given. */}
          {/* The list's figure, at the end with the actions: pushed right on a
              wide screen, a line of its own on a phone. When there are actions
              too, they follow it and the push is the summary's. */}
          {toolbarSummary && (
            <div className="flex min-w-0 items-center gap-2 text-sm sm:ml-auto">{summary}</div>
          )}
          {action && (
            <div
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

      {/* Set once, then read off the badge. Deliberately the same dialog the
          rest of the app collects things in, rather than a bar that grows: what
          is being done here is filling in a short form, and the sheet is what
          this app opens for that. */}
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
            {/* Nothing is pending, because every control above has already
                applied itself, so this is "put it all back", not "cancel". */}
            <Button variant="ghost" onClick={controls.clearFilters} disabled={activeFilters === 0}>
              {t("clearFilters")}
            </Button>
            <Button onClick={() => setFiltering(false)}>{t("filtersDone")}</Button>
          </ModalFooter>
        </Modal>
      )}

      {data.length === 0 ? (
        <EmptyNote size="page">{empty ?? t("empty")}</EmptyNote>
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

          {/* Six columns of Swedish resultUnit names add up to more than the card
              is wide until about 1280px, so without this the trailing ones,
              amount and actions, were unreachable rather than merely tight: past
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
                  const key = rowKey(row);
                  const under = expansion?.(row);
                  const open = Boolean(under) && (expandAll || opened.has(key));
                  return (
                  <Fragment key={key}>
                  {/* `[transform:translate(0)]` next to `relative`, and it is
                      the whole reason a click anywhere on the page used to open
                      the last row of the table in Safari.

                      WebKit computes `position: relative` on a table row as
                      static (bug 240961, fixed only in Safari Technology
                      Preview 243), so the stretched `before:` overlay below
                      found no containing block on its row and sized itself
                      against the initial one: every row's hit area covered the
                      whole document, and the last one in tree order sat on top
                      of the rest. An identity transform makes a containing
                      block in every engine, which is what `relative` was here
                      for. `relative` stays because it is what Chrome and
                      Firefox read, and keeping both leaves their behaviour
                      untouched.

                      Safe because every layer this app floats out of a row
                      (menus, comboboxes, dialogs, the receipt viewer) is
                      portalled to <body>, so no `position: fixed` descendant
                      is left measuring against a transformed row. */}
                  <tr
                    className={cn(
                      href && "relative cursor-pointer hover:bg-hover [transform:translate(0)]",
                      rowClassName?.(row),
                    )}
                  >
                    {cols.map((c) => (
                      <td key={c.key} className={cn(CELL_X, "py-4", alignCls(c.align), c.className)}>
                        {/* The link goes in the title cell and nowhere else:
                            one control per row, on the thing that names it.
                            `before:` stretches its hit area over the whole row,
                            so clicking anywhere still opens it, which is the mouse
                            behaviour the old row handler had, now provided by
                            the same element the keyboard uses.

                            A cell with a control of its own has to climb over
                            that overlay: `relative z-10` on whatever wraps it.
                            Positioned things at the auto level paint in tree
                            order, so a control *after* this cell is already
                            above it and one *before* it is not, which is why a
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
                        ) : c === slots.title && under ? (
                          // The chevron goes on the thing the row is named
                          // after, which is what somebody clicks to ask "what
                          // is this made of".
                          <span className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => toggle(key)}
                              aria-expanded={open}
                              className="relative z-10 -ml-1 shrink-0 rounded-control p-0.5 text-muted hover:bg-hover hover:text-foreground"
                            >
                              <IconChevronRight
                                className={cn("size-3.5 transition-transform", open && "rotate-90")}
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

/**
 * One row on a phone: a list row, not a card, in one shape for every table.
 *
 *   Kaffe till pubben                           1 240 kr
 *   Maja Holm, 12 okt                          [Väntar]
 *
 * The headline and its figure on the first line; who or what, and when, on the
 * second with the status opposite. See MobileSlot for what goes where.
 *
 * It was a headline with everything else run together under it, separated by
 * dashes: a reference, a date, a payment type, a name, a cost centre and a
 * status on one line of small grey text, nothing saying which was which, and
 * every row wrapping to a different height. The same four places on every row,
 * whatever the table, is what lets a list be read down rather than row by row.
 *
 * The headers are not lost to a screen reader: each value in the second line
 * is still announced with its header.
 */
function MobileRow<T>({
  row,
  slots,
  className,
  href,
}: {
  row: T;
  slots: MobileGroups<T>;
  className?: string;
  /** Where the row goes when opened. See `rowHref`. */
  href?: string;
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
        // min-h rather than a height: a headline long enough to wrap should take
        // the room, and 64px is what a row that does not wrap comes to: a
        // thumb's worth, and a rhythm the eye can count down the screen.
        "flex min-h-16 items-center gap-3 px-inset py-3",
        href && "relative cursor-pointer active:bg-surface",
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-3">
          {/* The headline is the link, and its hit area covers the row. The
              actions sit above it (later in the stacking order), so a button on
              a row is still a button and not a navigation. `*:truncate` for a
              cell that renders its own block. */}
          <div className="min-w-0 flex-1 truncate text-sm font-medium *:truncate">
            {href ? (
              <Link href={href} className="before:absolute before:inset-0">
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
            {/* One line, ending in an ellipsis rather than wrapping: the second
                line is two short facts, and a row that grows a third line for
                one long name is a list whose rows cannot be counted.
                `relative` so the screen-reader labels, which are absolutely
                positioned, are clipped here rather than widening the page.
                A <div>, not a <p>: a cell may render a block, and a <p> cannot
                hold one without the browser hoisting it out. A cell that is a
                block in the table gives a `mobileCell` that is not. */}
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

      {/* That this opens something: a phone has no hover to say so. Dropped
          where the row carries actions, since two right-hand affordances on a
          390px row is a row you have to aim at. */}
      {href && actions.length === 0 && (
        <IconChevronRight aria-hidden className="size-4 shrink-0 text-faint" />
      )}
    </div>
  );
}

// Sortable table header cell. Renders a <th> with a sort indicator.
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
      // What the column is sorted by, in the one attribute assistive tech reads
      // for it. Without this a screen reader user could reorder a table and be
      // told nothing about what had changed, or that it was sortable at all.
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
            not this column is the sorted one. It is hidden with `text-transparent`
            so the header keeps its width, which means it is a lie on every
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

// Pagination footer, rendered by DataTable after the list.
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

  const btn = "flex size-8 items-center justify-center rounded-control border border-border bg-background text-sm transition-colors hover:bg-hover disabled:opacity-40 disabled:pointer-events-none";

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border px-inset py-3">
      <p className="text-xs text-muted">
        {totalItems === 0 ? t("noResults") : t("showing", { from, to, total: totalItems })}
      </p>
      <div className="flex items-center gap-2">
        {/* The app's own picker, not a bare <select>. This was the last one in
            the app, and it carried its own 32px box: shorter than every other
            compact control, a different corner radius, and below the 44px both
            Apple and Google ask of something you tap. `size="sm"` is the same
            table CONTROL_SIZES hands the filter bar above it.

            Not searchable: a box to type in, in order to choose between four
            numbers, is more work than the menu it would shorten.

            On a phone the picker and the arrows are what matter; the words
            around them are the first thing to give up the width. */}
        <span className="flex items-center gap-1.5 text-xs text-muted">
          <span className="hidden sm:inline">{t("show")}</span>
          <Combobox
            size="sm"
            searchable={false}
            // An explicit width, because the trigger is `w-full` of this
            // wrapper: left to shrink to fit, it has nothing to size against.
            // Wide enough for "200" beside the chevron at the compact size.
            className="w-24"
            // The visible words are gone below sm, so the picker carries its own.
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
