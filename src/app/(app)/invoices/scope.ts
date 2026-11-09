import type { SupplierInvoiceRow } from "@/lib/data/supplier-invoices";
import { inFiscalYear, type FiscalYear } from "@/lib/ui/fiscal-year";

/** Whose invoices. No Mina: a levfaktura arrives, nobody submits it. */
export type InvoiceScope = "unit" | "all";

export const INVOICE_TABS = ["attest", "book", "send", "exported", "all"] as const;
export type InvoiceTab = (typeof INVOICE_TABS)[number];

const INVOICE_TAB_HOLDS: Record<InvoiceTab, (r: SupplierInvoiceRow) => boolean> = {
  attest: (r) =>
    r.status === "ASSIGNED" || r.status === "PENDING_APPROVAL" || r.status === "CHANGES_REQUESTED",
  book: (r) => r.status === "APPROVED",
  send: (r) => r.status === "BOOKED",
  exported: (r) => r.status === "EXPORTED",
  all: () => true,
};

/** Own date, or the arrival date when none was read. Must match lib/data/nav-counts.ts. */
const invoiceYearDate = (r: Pick<SupplierInvoiceRow, "invoiceDate" | "receivedAt">) =>
  r.invoiceDate || r.receivedAt;

export function invoiceTabHolds(tab: InvoiceTab, year: FiscalYear | null) {
  const holds = INVOICE_TAB_HOLDS[tab];
  if (!year) return holds;
  return (r: SupplierInvoiceRow) => holds(r) && inFiscalYear(year, invoiceYearDate(r));
}

export const invoiceDefaultTab = (scope: InvoiceScope): InvoiceTab =>
  scope === "unit" ? "attest" : "book";

export function invoicesHref(scope: InvoiceScope, tab?: InvoiceTab): string {
  const q = new URLSearchParams({ scope });
  if (tab && tab !== invoiceDefaultTab(scope)) q.set("tab", tab);
  return `/invoices?${q}`;
}
