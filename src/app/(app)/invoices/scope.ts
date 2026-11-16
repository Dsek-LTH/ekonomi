/** Whose invoices. No Mina: a levfaktura arrives, nobody submits it. */
export type InvoiceScope = "unit" | "all";

export const INVOICE_TABS = ["attest", "book", "send", "exported", "all"] as const;
export type InvoiceTab = (typeof INVOICE_TABS)[number];

// The statuses behind each tab are in lib/data/supplier-invoices.ts (INVOICE_TAB_STATUSES).

export const invoiceDefaultTab = (scope: InvoiceScope): InvoiceTab =>
  scope === "unit" ? "attest" : "book";

export function invoicesHref(scope: InvoiceScope, tab?: InvoiceTab): string {
  const q = new URLSearchParams({ scope });
  if (tab && tab !== invoiceDefaultTab(scope)) q.set("tab", tab);
  return `/invoices?${q}`;
}
