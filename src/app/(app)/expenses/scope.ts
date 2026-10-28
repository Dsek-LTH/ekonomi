// Utlägg's scopes and stages, shared by the page and the table. Its own module
// because page.tsx runs on the server and cannot read values out of a
// "use client" file. See docs/navigation.md for the model this follows.

/**
 * Whose utlägg the list is about: the reader's own, the ones their result
 * units answer for (and so what they attest), or the section's.
 */
export type ExpenseScope = "mine" | "unit" | "all";

/**
 * The stages, as the `?tab=` values the URL carries, each grouped by who acts
 * next. "Utkast" holds the returned ones too, since the submitter acts on both.
 * Matched to statuses on the server, in lib/data/expenses.ts.
 */
export const EXPENSE_TABS = ["draft", "attest", "book", "export", "done", "all"] as const;
export type ExpenseTab = (typeof EXPENSE_TABS)[number];

/**
 * The tab a scope opens on: the stage that needs the reader there. Your own
 * open on all of them, since every stage of your own is worth seeing. The
 * server and the table have to agree on what an unstated tab means.
 */
export const expenseDefaultTab = (scope: ExpenseScope): ExpenseTab =>
  scope === "unit" ? "attest" : scope === "all" ? "book" : "all";

/** A link to the list at one scope and stage, leaving out what is default. */
export function expensesHref(scope: ExpenseScope, tab?: ExpenseTab): string {
  const q = new URLSearchParams({ scope });
  if (tab && tab !== expenseDefaultTab(scope)) q.set("tab", tab);
  return `/expenses?${q}`;
}
