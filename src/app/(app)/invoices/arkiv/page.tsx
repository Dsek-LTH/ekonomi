import { requirePage } from "@/lib/server/current-user";
import { getInvoiceRows } from "@/lib/data/supplier-invoices";
import { canSeeInvoices } from "@/lib/domain/permissions";
import { ArchiveClient } from "./archive-client";

// Every invoice the reader may see, for looking one up. The same visibility as
// the inbox (lib/data/supplier-invoices.ts), only drawn as a table.
export default async function InvoiceArchivePage() {
  const user = await requirePage(canSeeInvoices);
  return <ArchiveClient rows={await getInvoiceRows(user)} />;
}
