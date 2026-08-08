"use client";

// What a list screen is currently showing, as React state — the other half of
// list-query.ts, which is the value itself and how it is spelled in a URL.
//
// It lived in components/ui for a while, beside spinner.tsx and chip.tsx, which
// is the wrong shelf: this is not a UI primitive, it is the client end of the
// list-query subsystem, and it re-exported that module's own types to get at
// them. The distance showed — the URL-backed hook was parsing the address
// without the `defaultTab` the page had passed to `parseListQuery` four lines
// away in another file, so the two disagreed about which tab was in force.
//
// The two components that draw the controls (the sortable header and the pager)
// went the other way, into data-table.tsx, which was their only caller.
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useProgressRouter } from "@/components/shell/route-progress";
import {
  DEFAULT_PAGE_SIZE,
  PAGE_SIZES,
  listQueryToSearch,
  parseListQuery,
  type ListQuery,
  type PageSize,
  type SortDir,
} from "./list-query";

export { PAGE_SIZES };
export type { PageSize, SortDir };

// ── The two kinds of list, as two types ───────────────────────────
//
// A list either has the database choose its rows or does it in the browser, and
// the components that draw the two are different (DataTable / ClientDataTable).
// These are the halves that go with them: `ClientControls` can paginate a set
// of rows because it has them all, `ServerControls` knows a total it was told
// because it does not. Handing one to the wrong component does not compile,
// which is what stops a server-backed table from quietly filtering nothing.
type BaseControls = {
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
  sortKey: string | null;
  sortDir: SortDir;
  toggleSort: (key: string) => void;
  /**
   * The page's own segmented toggle (whose utlägg to show), where it has one.
   * Carried here so it travels with the rest of the list's state — on a
   * URL-backed list it is a filter like any other and belongs in the address.
   */
  view: string;
  setView: (v: string) => void;
};

/** A list the database narrowed. The total is what it reported. */
export type ServerControls = BaseControls & {
  server: true;
  /** Matching rows in the database, not on this page — the pager needs both. */
  total: number;
};

/** A list narrowed in the browser, which therefore holds every row. */
export type ClientControls = BaseControls & {
  server: false;
  paginate: <T>(items: T[]) => T[];
};

/** Either kind, for the few helpers that genuinely take both. */
export type TableControlState = ServerControls | ClientControls;

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
  const [tab, setTabRaw]           = useState(d.tab);
  const [picks, setPicksRaw]       = useState(d.picks);
  const [query, setQueryRaw]       = useState(d.query);
  const [dateFrom, setDateFromRaw] = useState(d.dateFrom);
  const [dateTo, setDateToRaw]     = useState(d.dateTo);
  const [pageSize, setPageSizeRaw] = useState<PageSize>(d.pageSize);
  const [page, setPage]            = useState(d.page);
  const [sortKey, setSortKey]      = useState<string | null>(d.sortKey);
  const [sortDir, setSortDir]      = useState<SortDir>(d.sortDir);
  const [view, setViewRaw]         = useState(d.view);

  const withReset = <A,>(set: (v: A) => void) => (v: A) => { setPage(0); set(v); };
  const setTab       = withReset(setTabRaw);
  const setPicks     = withReset(setPicksRaw);
  const setQuery     = withReset(setQueryRaw);
  const setDateFrom  = withReset(setDateFromRaw);
  const setDateTo    = withReset(setDateToRaw);
  const setPageSize  = withReset(setPageSizeRaw);
  const setView      = withReset(setViewRaw);

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

  return { tab, setTab, picks, setPicks, query, setQuery, dateFrom, setDateFrom, dateTo, setDateTo, pageSize, setPageSize, page, setPage, paginate, sortKey, sortDir, toggleSort, view, setView, server: false };
}

// ── The same controls, kept in the URL ────────────────────────────
//
// For a list whose query runs on the server. The state lives in the address
// rather than in this component: the rows are chosen by the Server Component
// above, and the only thing it can read a choice from is its own URL.
//
// What that buys beyond the paging: a filtered list is now a link. It survives
// a reload, it can be sent to someone, and the browser's Back button walks back
// through it. None of that was possible while the state was useState.

/** How long a search box sits still before the server is asked again. */
const SEARCH_DEBOUNCE_MS = 300;

export function useUrlTableControls(
  total: number,
  /**
   * The tab in force when the URL names none — the same value the page passed
   * to `parseListQuery`, and the reason this is an argument at all.
   *
   * The page parses the URL to build its query, and this parses it again to
   * draw the controls. Only the page was passing a default, so on a list whose
   * first tab is a real filter the two parses disagreed: the query ran with
   * "PENDING" while `q.tab` here was "" and the highlighted tab came from
   * DataTable falling back to its first option. It worked only because that
   * first option happened to *be* PENDING, an agreement nothing enforced.
   */
  defaultTab?: string,
): ServerControls {
  const router = useProgressRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  // The URL is the state. Re-parsed on every render, which is cheap and means
  // Back, Forward and a pasted link all land in exactly the same place as a
  // click — there is no second copy of this to keep in step.
  const q = parseListQuery(Object.fromEntries(params.entries()), { defaultTab });

  const commit = useCallback(
    (next: Partial<ListQuery>) => {
      const merged = {
        ...parseListQuery(Object.fromEntries(params.entries()), { defaultTab }),
        ...next,
      };
      const search = listQueryToSearch(merged);
      // `replace`, not `push`: narrowing a list is adjusting a view, not going
      // somewhere. Pushing would put every keystroke and every tab on the
      // history stack, and Back out of the list would take a dozen presses.
      router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false });
    },
    [params, pathname, router, defaultTab],
  );

  // Everything except the search box resets to the first page: page 4 of a
  // narrower list is usually past the end of it, and an empty table is a
  // confusing answer to "show me the drafts".
  const set = <K extends keyof ListQuery>(key: K) => (v: ListQuery[K]) =>
    commit({ [key]: v, page: 0 } as Partial<ListQuery>);

  // The search box is the one control that can't wait for a round trip per
  // change. It is echoed locally so typing stays instant, and the server is
  // asked once the typing stops.
  const [draft, setDraft] = useState(q.q);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Re-seed when the URL's own q moves without us typing — Back, or a link.
  const committedQ = useRef(q.q);
  useEffect(() => {
    if (q.q !== committedQ.current) {
      committedQ.current = q.q;
      setDraft(q.q);
    }
  }, [q.q]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const setQuery = (v: string) => {
    setDraft(v);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      committedQ.current = v;
      commit({ q: v, page: 0 });
    }, SEARCH_DEBOUNCE_MS);
  };

  const toggleSort = (key: string) => {
    // Same rule as the local version: re-clicking the active column flips it,
    // a new column starts ascending.
    const dir: SortDir = q.sort === key && q.dir === "asc" ? "desc" : "asc";
    commit({ sort: key, dir, page: 0 });
  };

  return {
    tab: q.tab,
    setTab: set("tab"),
    picks: q.picks,
    setPicks: set("picks"),
    query: draft,
    setQuery,
    dateFrom: q.from,
    setDateFrom: set("from"),
    dateTo: q.to,
    setDateTo: set("to"),
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
