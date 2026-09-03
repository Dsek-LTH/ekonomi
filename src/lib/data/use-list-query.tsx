"use client";

// What a list screen is currently showing, as React state, the other half of
// list-query.ts, which is the value itself and how it is spelled in a URL.
//
// It lived in components/ui for a while, beside spinner.tsx and chip.tsx, which
// is the wrong shelf: this is not a UI primitive, it is the client end of the
// list-query subsystem, and it re-exported that module's own types to get at
// them. The distance showed: the URL-backed hook was parsing the address
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
  isWholeDate,
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
  // narrowing anything, which is its resting state, unlike `tab`, where one
  // option is always in force.
  picks: string[];
  setPicks: (v: string[]) => void;
  query: string;
  setQuery: (v: string) => void;
  dateFrom: string;
  setDateFrom: (v: string) => void;
  dateTo: string;
  setDateTo: (v: string) => void;
  /**
   * Picks and the date range back to their resting state, in one move.
   *
   * One move because on a URL-backed list each setter is a navigation, and
   * three of them fired from the same handler do not see each other's work:
   * `commit` reads the address as it stands, which does not change until the
   * router has been round the houses, so each write was merged onto the
   * address the *first* one started from and the last one out won. Clearing
   * the sheet left the picks it had just cleared. The search box is not part
   * of this, it is not in the sheet either. See DataTable's filter sheet.
   */
  clearFilters: () => void;
  pageSize: PageSize;
  setPageSize: (n: PageSize) => void;
  page: number;
  setPage: (n: number) => void;
  sortKey: string | null;
  sortDir: SortDir;
  toggleSort: (key: string) => void;
  /**
   * The page's own segmented toggle (whose utlägg to show), where it has one.
   * Carried here so it travels with the rest of the list's state. On a
   * URL-backed list it is a filter like any other and belongs in the address.
   */
  view: string;
  setView: (v: string) => void;
};

/** A list the database narrowed. The total is what it reported. */
export type ServerControls = BaseControls & {
  server: true;
  /** Matching rows in the database, not on this page. The pager needs both. */
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
  // Three state writes React batches into one render. Nothing to merge here,
  // unlike the URL-backed version below.
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

  return { tab, setTab, picks, setPicks, query, setQuery, dateFrom, setDateFrom, dateTo, setDateTo, clearFilters, pageSize, setPageSize, page, setPage, paginate, sortKey, sortDir, toggleSort, view, setView, server: false };
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

/** Whatever was typed is worth asking about. The search box's rule. */
const always = () => true;

/** A whole date, or nothing at all. Anything in between is still being typed. */
const wholeOrEmpty = (v: string) => v === "" || isWholeDate(v);

/**
 * A control whose value lives in the URL but is typed into.
 *
 * The URL is the state, and on these pages a URL change is a Server Component
 * render, a round trip. A controlled input reading straight from it therefore
 * shows nothing until the trip lands, which means every character is thrown
 * away in front of you, and every character starts another trip.
 *
 * So the draft is echoed here and the URL is written on the caller's terms:
 *
 *   the search box  commits anything, once the typing stops
 *   a date          commits only a whole one, and empty to clear it. A
 *                   half-typed date is not a filter, and parseListQuery drops
 *                   it on the way back in, which is what blanked the field
 *
 * Returns the draft to render and the setter to hand the input.
 */
function useUrlDraft(
  committed: string,
  commit: (value: string) => void,
  { ready, debounceMs = 0 }: { ready: (value: string) => boolean; debounceMs?: number },
): [string, (value: string) => void] {
  const [draft, setDraft] = useState(committed);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // What we last wrote, so the effect below can tell the URL moving on its own
  // from the URL moving because of us.
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

export function useUrlTableControls(
  total: number,
  /**
   * The tab in force when the URL names none, the same value the page passed
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
  // click. There is no second copy of this to keep in step.
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
  //
  // One call per handler. `commit` merges onto the address as it stands, and
  // the address stands still until the navigation lands, so two of these in a
  // row would both be merged onto the state the first one started from and the
  // second would undo the first. Anything that changes two things at once
  // says so in a single commit, as `clearFilters` does.
  const set = <K extends keyof ListQuery>(key: K) => (v: ListQuery[K]) =>
    commit({ [key]: v, page: 0 } as Partial<ListQuery>);

  // The three controls that are typed into rather than clicked. None of them
  // can wait for a round trip per keystroke. See useUrlDraft.
  const [query, setQuery] = useUrlDraft(q.q, (v) => commit({ q: v, page: 0 }), {
    ready: always,
    debounceMs: SEARCH_DEBOUNCE_MS,
  });
  const [dateFrom, setDateFrom] = useUrlDraft(q.from, set("from"), { ready: wholeOrEmpty });
  const [dateTo, setDateTo] = useUrlDraft(q.to, set("to"), { ready: wholeOrEmpty });

  // The drafts above follow: clearing the dates in the URL is the URL moving
  // without anyone typing, which is what re-seeds them. See useUrlDraft.
  const clearFilters = () => commit({ picks: [], from: "", to: "", page: 0 });

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
