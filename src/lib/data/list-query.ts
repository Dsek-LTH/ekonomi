// What a list screen is currently showing — which page, which tab, what was
// typed in the search box, how it is sorted — as one value, read from the URL.
//
// It lives in the URL rather than in React state because the query now runs on
// the server: the page is a Server Component, so the only thing it can read a
// filter from is its own address. That the address then describes the view is
// the part worth having — a filtered list can be linked to, reloaded, and
// walked back through with the browser's own Back button, none of which the
// component state it replaces could do.
//
// Nothing here knows about expenses or bank transactions. Each list translates
// this value into its own query (see `expenseListWhere`, `bankListWhere`),
// because only the list knows what its tabs mean.

/** Rows per page. The set the size picker offers. */
export const PAGE_SIZES = [10, 25, 50] as const;
export type PageSize = (typeof PAGE_SIZES)[number];
export const DEFAULT_PAGE_SIZE: PageSize = 25;

export type SortDir = "asc" | "desc";

export interface ListQuery {
  /** 0-based, as the slice was. */
  page: number;
  pageSize: PageSize;
  /** The active tab's value; "" means the list's own first tab. */
  tab: string;
  /**
   * The dropdown filter's picked values, OR-ed. Empty is its resting state and
   * narrows nothing — unlike `tab`, where one option is always in force.
   */
  picks: string[];
  /**
   * The page's own segmented toggle, where it has one: whose utlägg the list is
   * showing ("MINE" / "ALL"). Not every list has one, and what the values mean
   * is the page's business — this only carries it.
   */
  view: string;
  /** The search box. Matched by each list against its own text columns. */
  q: string;
  /** Date range, inclusive, as YYYY-MM-DD. "" for open-ended. */
  from: string;
  to: string;
  /** Column key, or "" for the list's default order. */
  sort: string;
  dir: SortDir;
}

/** What a Next page receives as `searchParams`. */
export type SearchParams = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined): string =>
  (Array.isArray(v) ? v[0] : v)?.trim() ?? "";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Is this a date a filter can be run on — a whole YYYY-MM-DD?
 *
 * Exported because both ends of the round trip have to agree about it. This
 * file drops anything else on the way *in* (see `from`/`to` below); the
 * controls that write the URL have to hold the same line on the way out, or a
 * half-typed date is written to an address that then reads back as no date at
 * all, and the character you just typed disappears as you type it.
 */
export const isWholeDate = (v: string) => ISO_DATE.test(v);

/**
 * Read a list's state out of a URL.
 *
 * Every field falls back to its default rather than rejecting: a URL is
 * something people edit, bookmark and truncate, and a list asked for page
 * "banana" should show the first page, not an error. That also makes the
 * bare route — no query string at all — the ordinary first view.
 */
export function parseListQuery(
  sp: SearchParams,
  opts: {
    /**
     * The tab in force when the URL names none.
     *
     * DataTable falls back to its *first* tab when `tab` matches no option, so
     * a list whose first tab is a real filter ("Väntar") must say so here —
     * otherwise the address bar and the highlighted tab describe one view and
     * the query behind them another. Lists whose first tab is "Alla" have
     * nothing to declare: no tab and no filter are the same thing there.
     */
    defaultTab?: string;
  } = {},
): ListQuery {
  const size = Number(one(sp.size));
  const page = Number(one(sp.page));
  const from = one(sp.from);
  const to = one(sp.to);
  const dir = one(sp.dir);

  return {
    page: Number.isInteger(page) && page > 0 ? page : 0,
    pageSize: (PAGE_SIZES as readonly number[]).includes(size)
      ? (size as PageSize)
      : DEFAULT_PAGE_SIZE,
    tab: one(sp.tab) || (opts.defaultTab ?? ""),
    // Comma-separated, so several picks stay one readable parameter.
    picks: one(sp.picks).split(",").filter(Boolean),
    view: one(sp.view),
    q: one(sp.q),
    // A half-typed date out of the picker is not a filter yet. Anything that
    // isn't a whole YYYY-MM-DD is dropped rather than handed to `new Date`,
    // which would turn it into either the wrong day or Invalid Date.
    from: ISO_DATE.test(from) ? from : "",
    to: ISO_DATE.test(to) ? to : "",
    sort: one(sp.sort),
    dir: dir === "desc" ? "desc" : "asc",
  };
}

/**
 * The query as a URL query string, leaving out everything still at its default
 * so the common case is a clean address.
 */
export function listQueryToSearch(q: ListQuery): string {
  const p = new URLSearchParams();
  if (q.page > 0) p.set("page", String(q.page));
  if (q.pageSize !== DEFAULT_PAGE_SIZE) p.set("size", String(q.pageSize));
  if (q.tab) p.set("tab", q.tab);
  if (q.picks.length) p.set("picks", q.picks.join(","));
  if (q.view) p.set("view", q.view);
  if (q.q) p.set("q", q.q);
  if (q.from) p.set("from", q.from);
  if (q.to) p.set("to", q.to);
  if (q.sort) {
    p.set("sort", q.sort);
    p.set("dir", q.dir);
  }
  return p.toString();
}

/** One page of rows, and how many there are in total behind it. */
export interface RowPage<T> {
  rows: T[];
  /** Matching rows in the database, not on this page — the pager needs both. */
  total: number;
}

/** `skip`/`take` for a query, straight from the page and its size. */
export function pageBounds(q: ListQuery): { skip: number; take: number } {
  return { skip: q.page * q.pageSize, take: q.pageSize };
}

/**
 * An inclusive date range as a Prisma filter, or undefined when neither end is
 * set. `to` is pushed to the end of its day for a column that stores a time;
 * pass `dateOnly` for a `@db.Date` column, where the day itself is the value.
 */
export function dateRangeFilter(
  q: ListQuery,
  { dateOnly = false }: { dateOnly?: boolean } = {},
): { gte?: Date; lte?: Date } | undefined {
  if (!q.from && !q.to) return undefined;
  const range: { gte?: Date; lte?: Date } = {};
  if (q.from) range.gte = new Date(`${q.from}T00:00:00.000Z`);
  if (q.to) {
    range.lte = new Date(dateOnly ? `${q.to}T00:00:00.000Z` : `${q.to}T23:59:59.999Z`);
  }
  return range;
}
