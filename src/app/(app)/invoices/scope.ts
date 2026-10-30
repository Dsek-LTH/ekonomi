// Fakturor's scopes and stages, shared by the page and the table, the same
// shape as Utlägg's (see ../expenses/scope.ts and docs/navigation.md).
import type { SupplierInvoiceRow } from "@/lib/data/supplier-invoices";
import { inFiscalYear, type FiscalYear } from "@/lib/ui/fiscal-year";

/**
 * Whose invoices: the ones given to the reader's result units, or the
 * section's. There is no Mina: nobody submits a levfaktura, it arrives.
 */
export type InvoiceScope = "unit" | "all";

/** The stages, as `?tab=` values, each grouped by who acts next: the units
 *  (fördela and attestera), then the treasury (kontera, then send). */
export const INVOICE_TABS = ["attest", "book", "send", "exported", "all"] as const;
export type InvoiceTab = (typeof INVOICE_TABS)[number];

/** Which rows each stage holds. "all" holds every one. */
export const INVOICE_TAB_HOLDS: Record<InvoiceTab, (r: SupplierInvoiceRow) => boolean> = {
  attest: (r) => r.status === "ASSIGNED" || r.status === "PENDING_APPROVAL" || r.status === "CHANGES_REQUESTED",
  book: (r) => r.status === "APPROVED",
  send: (r) => r.status === "BOOKED",
  exported: (r) => r.status === "EXPORTED",
  all: () => true,
};

/**
 * An invoice's date, for the räkenskapsår: its own date, or when it arrived
 * for one nobody has read a date off. The nav's count asks the same, see
 * lib/data/nav-counts.ts.
 */
export const invoiceYearDate = (r: Pick<SupplierInvoiceRow, "invoiceDate" | "receivedAt">) =>
  r.invoiceDate || r.receivedAt;

/**
 * Which rows a stage holds in a year: the stage's own rows dated in it, on
 * every stage, the work ones too. See docs/navigation.md.
 */
export function invoiceTabHolds(tab: InvoiceTab, year: FiscalYear | null) {
  const holds = INVOICE_TAB_HOLDS[tab];
  if (!year) return holds;
  return (r: SupplierInvoiceRow) => holds(r) && inFiscalYear(year, invoiceYearDate(r));
}

/** The tab a scope opens on: the stage that needs the reader there. */
export const invoiceDefaultTab = (scope: InvoiceScope): InvoiceTab =>
  scope === "unit" ? "attest" : "book";

/** A link to the list at one scope and stage, leaving out what is default. */
export function invoicesHref(scope: InvoiceScope, tab?: InvoiceTab): string {
  const q = new URLSearchParams({ scope });
  if (tab && tab !== invoiceDefaultTab(scope)) q.set("tab", tab);
  return `/invoices?${q}`;
}
