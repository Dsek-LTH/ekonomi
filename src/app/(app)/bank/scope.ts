// The bank feed's readings, shared by the page (server) and the table ("use client").

/** Whose purchases are read: the reader's own, their result units' cards, or the section's. */
export type BankScope = "mine" | "unit" | "all";

/** The stages as `?tab=` values: purchases still to turn into an utlägg, those that have been, and on the section's reading the ones on no card. See docs/navigation.md. */
export const BANK_TABS = ["unaccounted", "accounted", "nocard", "all"] as const;
export type BankTab = (typeof BANK_TABS)[number];

/** The tab a scope opens on. A unit's is read, not worked, so it opens on all. The server and the table must agree on the default. */
export const bankDefaultTab = (scope: BankScope): BankTab =>
  scope === "unit" ? "all" : "unaccounted";
