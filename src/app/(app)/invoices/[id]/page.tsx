import { requirePage } from "@/lib/server/current-user";
import { canSeeInvoices } from "@/lib/domain/permissions";
import { isTreasury, loadWorkspace } from "../load";
import { invoicesHref } from "../scope";
import { InvoiceDetailClient, InvoiceMissing } from "./invoice-client";

// One levfaktura: what it says, what it is waiting for, and its PDF in the
// panel beside it. Opened from Fakturor or from a mail.
export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePage(canSeeInvoices);
  const data = await loadWorkspace(id, user);
  if (!data) return <InvoiceMissing />;
  // Back to the reading the reader works it from: the treasury books the
  // section's, everyone else attests their unit's.
  return (
    <InvoiceDetailClient
      data={data}
      backHref={isTreasury(user) ? invoicesHref("all") : invoicesHref("unit")}
    />
  );
}
