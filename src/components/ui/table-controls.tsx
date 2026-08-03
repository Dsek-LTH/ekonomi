"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/ui/utils";
import { IconChevronLeft, IconChevronRight } from "./icons";

const PAGE_SIZES = [10, 25, 50] as const;
export type PageSize = (typeof PAGE_SIZES)[number];

export type SortDir = "asc" | "desc";

export type TableControlState = {
  tab: string;
  setTab: (v: string) => void;
  // Values active in DataTable's dropdown filter. Empty means it isn't
  // narrowing anything, which is its resting state — unlike `tab`, where one
  // option is always in force.
  picks: string[];
  setPicks: (v: string[]) => void;
  query: string;
  setQuery: (v: string) => void;
  dateFrom: string;
  setDateFrom: (v: string) => void;
  dateTo: string;
  setDateTo: (v: string) => void;
  pageSize: PageSize;
  setPageSize: (n: PageSize) => void;
  page: number;
  setPage: (n: number) => void;
  paginate: <T>(items: T[]) => T[];
  sortKey: string | null;
  sortDir: SortDir;
  toggleSort: (key: string) => void;
};

export type TableControlDefaults = {
  tab?: string;
  picks?: string[];
  query?: string;
  dateFrom?: string;
  dateTo?: string;
  pageSize?: PageSize;
  page?: number;
  sortKey?: string | null;
  sortDir?: SortDir;
};

const defaultTableControls: Required<TableControlDefaults> = {
  tab: "",
  picks: [],
  query: "",
  dateFrom: "",
  dateTo: "",
  pageSize: 25,
  page: 0,
  sortKey: null,
  sortDir: "asc",
};

export function useTableControls(defaults: TableControlDefaults = {}): TableControlState {
  const d = { ...defaultTableControls, ...defaults };
  const [tab, setTabRaw]           = useState(d.tab);
  const [picks, setPicksRaw]       = useState(d.picks);
  const [query, setQueryRaw]       = useState(d.query);
  const [dateFrom, setDateFromRaw] = useState(d.dateFrom);
  const [dateTo, setDateToRaw]     = useState(d.dateTo);
  const [pageSize, setPageSizeRaw] = useState<PageSize>(d.pageSize);
  const [page, setPage]            = useState(d.page);
  const [sortKey, setSortKey]      = useState<string | null>(d.sortKey);
  const [sortDir, setSortDir]      = useState<SortDir>(d.sortDir);

  const withReset = <A,>(set: (v: A) => void) => (v: A) => { setPage(0); set(v); };
  const setTab       = withReset(setTabRaw);
  const setPicks     = withReset(setPicksRaw);
  const setQuery     = withReset(setQueryRaw);
  const setDateFrom  = withReset(setDateFromRaw);
  const setDateTo    = withReset(setDateToRaw);
  const setPageSize  = withReset(setPageSizeRaw);

  const toggleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
    setPage(0);
  };

  const paginate = <T,>(items: T[]): T[] => items.slice(page * pageSize, (page + 1) * pageSize);

  return { tab, setTab, picks, setPicks, query, setQuery, dateFrom, setDateFrom, dateTo, setDateTo, pageSize, setPageSize, page, setPage, paginate, sortKey, sortDir, toggleSort };
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
  return (
    <th
      onClick={() => controls.toggleSort(key)}
      className={cn("cursor-pointer select-none whitespace-nowrap", className)}
    >
      {children}
      <span className={cn("ml-1 text-[10px]", active ? "text-accent" : "text-transparent")}>
        {controls.sortDir === "asc" ? "▲" : "▼"}
      </span>
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
