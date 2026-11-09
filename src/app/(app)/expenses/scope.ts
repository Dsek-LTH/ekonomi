// Scopes and stages, shared by the page and the table (page.tsx is server and cannot read a "use client" file).

export type ExpenseScope = "mine" | "unit" | "all";

/** `?tab=` values, grouped by who acts next. "Utkast" holds returned ones too. Matched to statuses in lib/data/expenses.ts. */
export const EXPENSE_TABS = ["draft", "attest", "book", "export", "done", "all"] as const;
export type ExpenseTab = (typeof EXPENSE_TABS)[number];

/** The tab a scope opens on. Server and table must agree on what an unstated tab means. */
export const expenseDefaultTab = (scope: ExpenseScope): ExpenseTab =>
  scope === "unit" ? "attest" : scope === "all" ? "book" : "all";

export function expensesHref(scope: ExpenseScope, tab?: ExpenseTab): string {
  const q = new URLSearchParams({ scope });
  if (tab && tab !== expenseDefaultTab(scope)) q.set("tab", tab);
  return `/expenses?${q}`;
}
