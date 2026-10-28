// The bank feed's readings, shared by the page and the table. Its own module
// because page.tsx runs on the server and cannot call into a "use client" file.

/**
 * Whose purchases are being read: the reader's own, the cards of the result
 * units they answer for, or the section's.
 */
export type BankScope = "mine" | "unit" | "all";

/**
 * The stages, as `?tab=` values, named for who acts next: the purchases still
 * to turn into an utlägg, the ones that have been, and on the section's
 * reading the ones on no card, which bookkeeping puts on one. See
 * docs/navigation.md.
 */
export const BANK_TABS = ["unaccounted", "accounted", "nocard", "all"] as const;
export type BankTab = (typeof BANK_TABS)[number];

/**
 * The tab a scope opens on: the stage that needs the reader there. Your own
 * and the section's open on what is still to account for. A unit's is read,
 * not worked, so it opens on all of it. The server and the table have to agree
 * on what an unstated tab means.
 */
export const bankDefaultTab = (scope: BankScope): BankTab =>
  scope === "unit" ? "all" : "unaccounted";
