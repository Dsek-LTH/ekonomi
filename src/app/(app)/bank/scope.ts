// The bank feed's readings, shared by the page and the table. Its own module
// because page.tsx runs on the server and cannot call into a "use client" file.

/**
 * Whose purchases are being read: the reader's own, the cards of the result
 * units they answer for, or the section's.
 */
export type BankScope = "mine" | "unit" | "all";

/**
 * The tab a scope opens on. Your own purchases open on the ones still to
 * account for, the only thing in the list you can act on. A unit's and the
 * section's open on all of it. The server and the table have to agree on what
 * an unstated tab means.
 */
export const bankDefaultTab = (scope: BankScope) => (scope === "mine" ? "UNMATCHED" : "ALL");
