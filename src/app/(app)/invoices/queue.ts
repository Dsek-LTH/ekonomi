// The order invoices are worked in, shared by the server page (which picks the
// one to open) and the client (which moves on to the next). A plain module,
// not a client one, so the server can call it.
import type { InvoiceQueue } from "@/lib/domain/supplier-invoice";
import type { SupplierInvoiceRow } from "@/lib/data/supplier-invoices";

/** The inbox's sections, in the order they are worked. "done" is not among
 *  them: what is in Fortnox is the archive's. */
export const SECTIONS: readonly Exclude<InvoiceQueue, "done">[] = ["sort", "attest", "export", "elsewhere"];

/** Soonest due first, the undated after the dated, then the oldest arrival:
 *  the order that costs least in påminnelseavgifter. */
const byDue = (a: SupplierInvoiceRow, b: SupplierInvoiceRow) =>
  (a.dueDate || "9999").localeCompare(b.dueDate || "9999") || a.receivedAt.localeCompare(b.receivedAt);

/** Every open invoice, section by section, each section by due date. */
export function orderedQueue(rows: readonly SupplierInvoiceRow[]): SupplierInvoiceRow[] {
  return SECTIONS.flatMap((s) => rows.filter((r) => r.queue === s).sort(byDue));
}

/** What a resultatansvarig has to attest, in the order to do it. */
export function focusQueue(rows: readonly SupplierInvoiceRow[]): SupplierInvoiceRow[] {
  return rows.filter((r) => r.queue === "attest").sort(byDue);
}

/** The one to open after `currentId` is done: the next in order, or failing
 *  that the one before it, or nothing when it was the last. */
export function nextAfter(queue: readonly SupplierInvoiceRow[], currentId: string): string | null {
  const i = queue.findIndex((r) => r.id === currentId);
  if (i < 0) return queue[0]?.id ?? null;
  return queue[i + 1]?.id ?? queue[i - 1]?.id ?? null;
}
