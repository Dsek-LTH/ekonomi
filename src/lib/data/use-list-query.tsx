"use client";

// Client end of list-query.ts: a list screen's state as React state.
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useProgressRouter } from "@/components/shell/route-progress";
import {
  DEFAULT_PAGE_SIZE,
  PAGE_SIZES,
  isWholeDate,
  listQueryToSearch,
  parseListQuery,
  type ListQuery,
  type PageSize,
  type SortDir,
} from "./list-query";

export { PAGE_SIZES };
export type { PageSize, SortDir };

// A list is either database-chosen (ServerControls, DataTable) or browser-cut (ClientControls,
// ClientDataTable); handing one to the wrong component does not compile.
type BaseControls = {
  tab: string;
  setTab: (v: string) => void;
  // DataTable's dropdown values. Empty narrows nothing, unlike `tab`.
  picks: string[];
  setPicks: (v: string[]) => void;
  query: string;
  setQuery: (v: string) => void;
  dateFrom: string;
  setDateFrom: (v: string) => void;
  dateTo: string;
  setDateTo: (v: string) => void;
  /**
   * Picks and the date range back to resting state in one move. On a URL-backed list each setter is a
   * navigation, and `commit` reads the address as it stands, so separate writes would undo each other.
   */
  clearFilters: () => void;
  pageSize: PageSize;
  setPageSize: (n: PageSize) => void;
  page: number;
  setPage: (n: number) => void;
  sortKey: string | null;
  sortDir: SortDir;
  toggleSort: (key: string) => void;
  /** The page's own segmented toggle (whose utlägg to show). On a URL-backed list it lives in the address. */
  view: string;
  setView: (v: string) => void;
};

export type ServerControls = BaseControls & {
  server: true;
  total: number;
};

export type ClientControls = BaseControls & {
  server: false;
  paginate: <T>(items: T[]) => T[];
};

export type TableControlState = ServerControls | ClientControls;

type TableControlDefaults = {
  tab?: string;
  picks?: string[];
  query?: string;
  dateFrom?: string;
  dateTo?: string;
  pageSize?: PageSize;
  page?: number;
  sortKey?: string | null;
  sortDir?: SortDir;
  view?: string;
};

const defaultTableControls: Required<TableControlDefaults> = {
  tab: "",
  picks: [],
  query: "",
  dateFrom: "",
  dateTo: "",
  pageSize: DEFAULT_PAGE_SIZE,
  page: 0,
  sortKey: null,
  sortDir: "asc",
  view: "",
};

export function useTableControls(defaults: TableControlDefaults = {}): ClientControls {
  const d = { ...defaultTableControls, ...defaults };
  const [tab, setTabRaw] = useState(d.tab);
  const [picks, setPicksRaw] = useState(d.picks);
  const [query, setQueryRaw] = useState(d.query);
  const [dateFrom, setDateFromRaw] = useState(d.dateFrom);
  const [dateTo, setDateToRaw] = useState(d.dateTo);
  const [pageSize, setPageSizeRaw] = useState<PageSize>(d.pageSize);
  const [page, setPage] = useState(d.page);
  const [sortKey, setSortKey] = useState<string | null>(d.sortKey);
  const [sortDir, setSortDir] = useState<SortDir>(d.sortDir);
  const [view, setViewRaw] = useState(d.view);

  const withReset =
    <A,>(set: (v: A) => void) =>
    (v: A) => {
      setPage(0);
      set(v);
    };
  const setTab = withReset(setTabRaw);
  const setPicks = withReset(setPicksRaw);
  const setQuery = withReset(setQueryRaw);
  const setDateFrom = withReset(setDateFromRaw);
  const setDateTo = withReset(setDateToRaw);
  const setPageSize = withReset(setPageSizeRaw);
  const setView = withReset(setViewRaw);
  const clearFilters = () => {
    setPage(0);
    setPicksRaw([]);
    setDateFromRaw("");
    setDateToRaw("");
  };

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

  return {
    tab,
    setTab,
    picks,
    setPicks,
    query,
    setQuery,
    dateFrom,
    setDateFrom,
    dateTo,
    setDateTo,
    clearFilters,
    pageSize,
    setPageSize,
    page,
    setPage,
    paginate,
    sortKey,
    sortDir,
    toggleSort,
    view,
    setView,
    server: false,
  };
}

// The same controls kept in the URL, for a list whose query runs on the server (linkable, survives reload, Back works).

/** How long a search box sits still before the server is asked again. */
const SEARCH_DEBOUNCE_MS = 300;

const always = () => true;

/** A whole date, or nothing at all. Anything in between is still being typed. */
const wholeOrEmpty = (v: string) => v === "" || isWholeDate(v);

/**
 * A control whose value lives in the URL but is typed into. A URL change is a Server Component round trip,
 * so a controlled input would lose characters. The draft is echoed and the URL written on the caller's terms:
 * the search box commits anything once typing stops; a date commits only a whole one (or empty to clear).
 */
function useUrlDraft(
  committed: string,
  commit: (value: string) => void,
  { ready, debounceMs = 0 }: { ready: (value: string) => boolean; debounceMs?: number },
): [string, (value: string) => void] {
  const [draft, setDraft] = useState(committed);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // What we last wrote, to tell the URL moving on its own from moving because of us.
  const ours = useRef(committed);

  // Re-seed when the URL's own value moves without us typing. Back, or a link.
  useEffect(() => {
    if (committed !== ours.current) {
      ours.current = committed;
      setDraft(committed);
    }
  }, [committed]);

  useEffect(() => () => clearTimeout(timer.current), []);

  const set = (value: string) => {
    setDraft(value);
    clearTimeout(timer.current);
    if (!ready(value)) return;
    const write = () => {
      ours.current = value;
      commit(value);
    };
    if (debounceMs) timer.current = setTimeout(write, debounceMs);
    else write();
  };

  return [draft, set];
}

// Every parameter `listQueryToSearch` can write, so `commit` knows which are the list's to rewrite.
const LIST_KEYS = ["page", "size", "tab", "picks", "view", "q", "from", "to", "sort", "dir"];

export function useUrlTableControls(
  total: number,
  /** The tab in force when the URL names none: the same value the page passed to `parseListQuery`, or the two parses disagree. */
  defaultTab?: string,
): ServerControls {
  const router = useProgressRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  // The URL is the state, re-parsed on every render so Back, Forward and pasted links land like a click.
  const q = parseListQuery(Object.fromEntries(params.entries()), { defaultTab });

  const commit = useCallback(
    (next: Partial<ListQuery>) => {
      const merged = {
        ...parseListQuery(Object.fromEntries(params.entries()), { defaultTab }),
        ...next,
      };
      // Whatever else the address carries (/bank's `scope`, say) belongs to the page and rides along untouched.
      const kept = new URLSearchParams(params.toString());
      for (const key of LIST_KEYS) kept.delete(key);
      const own = new URLSearchParams(listQueryToSearch(merged));
      for (const [k, v] of own) kept.set(k, v);
      const search = kept.toString();
      // `replace`, not `push`: narrowing a list adjusts a view, and pushing every keystroke would bury Back.
      router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false });
    },
    [params, pathname, router, defaultTab],
  );

  // Everything except the search box resets to the first page. One call per handler: `commit` merges onto
  // the address as it stands, so two in a row undo each other. Changing two things says so in one commit (`clearFilters`).
  const set =
    <K extends keyof ListQuery>(key: K) =>
    (v: ListQuery[K]) =>
      commit({ [key]: v, page: 0 } as Partial<ListQuery>);

  // The typed controls, which cannot wait a round trip per keystroke (see useUrlDraft).
  const [query, setQuery] = useUrlDraft(q.q, (v) => commit({ q: v, page: 0 }), {
    ready: always,
    debounceMs: SEARCH_DEBOUNCE_MS,
  });
  const [dateFrom, setDateFrom] = useUrlDraft(q.from, set("from"), { ready: wholeOrEmpty });
  const [dateTo, setDateTo] = useUrlDraft(q.to, set("to"), { ready: wholeOrEmpty });

  // Clearing the dates in the URL is the URL moving on its own, which re-seeds the drafts.
  const clearFilters = () => commit({ picks: [], from: "", to: "", page: 0 });

  const toggleSort = (key: string) => {
    // Re-clicking the active column flips it; a new column starts ascending.
    const dir: SortDir = q.sort === key && q.dir === "asc" ? "desc" : "asc";
    commit({ sort: key, dir, page: 0 });
  };

  return {
    tab: q.tab,
    setTab: set("tab"),
    picks: q.picks,
    setPicks: set("picks"),
    query,
    setQuery,
    dateFrom,
    setDateFrom,
    dateTo,
    setDateTo,
    clearFilters,
    pageSize: q.pageSize,
    setPageSize: set("pageSize"),
    page: q.page,
    // The one control that must NOT reset the page to zero.
    setPage: (n: number) => commit({ page: n }),
    sortKey: q.sort || null,
    sortDir: q.dir,
    toggleSort,
    view: q.view,
    setView: set("view"),
    server: true,
    total,
  };
}

/**
 * The scope switch's `onChange` for a list with `?scope=`. Keeps the stage (written out even at its default,
 * since defaults differ per scope), drops paging. `push`, not `replace`: whose list you read is a place you went.
 */
export function useScopeSwitch(
  tab: string,
  defaultTab: (scope: string) => string,
): (scope: string) => void {
  const router = useProgressRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return (next) => {
    const q = new URLSearchParams(params.toString());
    q.set("scope", next);
    if (tab && tab !== defaultTab(next)) q.set("tab", tab);
    else q.delete("tab");
    q.delete("page");
    router.push(`${pathname}?${q.toString()}`);
  };
}

/**
 * Client-side controls with the tab in the URL, for lists cut in the browser (Fakturor, Intäkter).
 * `replace`; the scope's own default is left out of the address.
 */
export function useUrlTab<C extends ClientControls>(local: C, defaultTab: string): C {
  const router = useProgressRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return {
    ...local,
    setTab: (v: string) => {
      local.setTab(v);
      const q = new URLSearchParams(params.toString());
      if (v === defaultTab) q.delete("tab");
      else q.set("tab", v);
      q.delete("page");
      const search = q.toString();
      router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false });
    },
  };
}
