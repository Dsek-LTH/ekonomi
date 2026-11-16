// The section's stocks. A fixed set: each has its own capabilities and its own pages, so one that only
// existed as a database row would be a stock nobody could open. What a person chooses about a stock
// (accounts, cost centres) is on its `Stock` row. See docs/stock.md.

export const STOCK_SLUGS = ["alcohol", "cafe"] as const;
export type StockSlug = (typeof STOCK_SLUGS)[number];

export const isStockSlug = (value: unknown): value is StockSlug =>
  typeof value === "string" && (STOCK_SLUGS as readonly string[]).includes(value);

/** What a stock does, as far as the screens and the rules need to know. */
export interface StockTraits {
  /** Stock goes out to a night and comes back: the bar's checkout and return sheet. */
  usesEvents: boolean;
  /** Opened bottles are kept on the 80/60/40/20 ladder. */
  usesOpenLevels: boolean;
  /** Files the restaurangrapport, so a product needs a drink category, a strength and a size. */
  filesRestaurangrapport: boolean;
  /** Stock is carried to places (a fridge, a committee), each charging its own cost centre, and moved between them. */
  usesPlaces: boolean;
  /** Board members may take from it and are invoiced at year end. */
  allowsBoardWithdrawals: boolean;
}

export const STOCKS: Record<StockSlug, StockTraits> = {
  alcohol: {
    usesEvents: true,
    usesOpenLevels: true,
    filesRestaurangrapport: true,
    usesPlaces: false,
    allowsBoardWithdrawals: false,
  },
  cafe: {
    usesEvents: false,
    usesOpenLevels: false,
    filesRestaurangrapport: false,
    usesPlaces: true,
    allowsBoardWithdrawals: true,
  },
};

/** Where a stock's pages live. */
export const stockPath = (stock: StockSlug, rest = ""): string => `/stock/${stock}${rest}`;
