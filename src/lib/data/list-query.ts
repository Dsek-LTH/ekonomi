// A list screen's state (page, tab, search, sort) as one value read from the URL, so a view is
// linkable and Back works. Each list translates it into its own query.

/** Rows per page. The set the size picker offers. */
export const PAGE_SIZES = [10, 25, 50] as const;
export type PageSize = (typeof PAGE_SIZES)[number];
export const DEFAULT_PAGE_SIZE: PageSize = 25;

export type SortDir = "asc" | "desc";

export interface ListQuery {
  page: number;
  pageSize: PageSize;
  /** The active tab's value; "" means the list's own first tab. */
  tab: string;
  /** Dropdown picks, OR-ed. Empty narrows nothing, unlike `tab`. */
  picks: string[];
  /** The page's own segmented toggle ("MINE" / "ALL"), if any. Its meaning is the page's business. */
  view: string;
  q: string;
  /** Date range, inclusive, as YYYY-MM-DD. "" for open-ended. */
  from: string;
  to: string;
  sort: string;
  dir: SortDir;
}

export type SearchParams = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined): string =>
  (Array.isArray(v) ? v[0] : v)?.trim() ?? "";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Whether this is a whole YYYY-MM-DD. The controls that write the URL must apply the same rule, or a half-typed date blanks the field. */
export const isWholeDate = (v: string) => ISO_DATE.test(v);

/** Read a list's state out of a URL. Every field falls back to its default rather than rejecting. */
export function parseListQuery(
  sp: SearchParams,
  opts: {
    /** The tab in force when the URL names none. DataTable falls back to its first tab, so a list whose first tab is a real filter must declare it. */
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
    picks: one(sp.picks).split(",").filter(Boolean),
    view: one(sp.view),
    q: one(sp.q),
    // A partial date is not a filter: drop it rather than hand it to `new Date`.
    from: ISO_DATE.test(from) ? from : "",
    to: ISO_DATE.test(to) ? to : "",
    sort: one(sp.sort),
    dir: dir === "desc" ? "desc" : "asc",
  };
}

/** The query as a URL query string, omitting defaults. */
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

export interface RowPage<T> {
  rows: T[];
  /** Matching rows in the database, not on this page. The pager needs both. */
  total: number;
}

export function pageBounds(q: ListQuery): { skip: number; take: number } {
  return { skip: q.page * q.pageSize, take: q.pageSize };
}

/** An inclusive date range as a Prisma filter. `to` is pushed to end of day; pass `dateOnly` for a `@db.Date` column. */
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
