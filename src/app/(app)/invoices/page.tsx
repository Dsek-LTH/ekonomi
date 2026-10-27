import { requirePage } from "@/lib/server/current-user";
import { getInboxHealth, getInvoiceRows } from "@/lib/data/supplier-invoices";
import { canSeeInvoices, canTriageInvoices } from "@/lib/domain/permissions";
import { InvoicesClient } from "./invoices-client";

// Leverantörsfakturor: the inkorg, and every invoice on its way from there to
// Fortnox. The same page for triage and for a resultatansvarig, narrowed to
// what each may see (lib/data/supplier-invoices.ts), with the tab it opens on
// being whatever is waiting on the reader.
export default async function InvoicesPage() {
  const user = await requirePage(canSeeInvoices);
  const canTriage = canTriageInvoices(user.capabilities);
  const [rows, health] = await Promise.all([
    getInvoiceRows(user),
    // Only triage is shown the mailbox: refused mail names who sent it, and
    // whether the sync is running is the treasury's to keep an eye on.
    canTriage ? getInboxHealth() : null,
  ]);
  return <InvoicesClient rows={rows} canTriage={canTriage} health={health} />;
}
