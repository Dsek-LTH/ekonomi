import { requirePage } from "@/lib/server/current-user";
import { canSeeInvoices } from "@/lib/domain/permissions";
import { getFortnoxStatus } from "@/lib/data/fortnox";
import { isTreasury, loadWorkspace } from "../load";
import { invoicesHref } from "../scope";
import { InvoiceMissing, InvoiceRecordClient } from "./record-client";

// One levfaktura's record: what it is, where it stands, and the next step as
// its main button. Opened from Fakturor, Att attestera and the mails.
export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePage(canSeeInvoices);
  const data = await loadWorkspace(id, user);
  if (!data) return <InvoiceMissing />;
  // With the user id, so the status carries their own Fortnox login as well
  // as the section's connection: sending needs both. Only asked of whoever
  // may send it.
  const fortnox = data.can.canSend ? await getFortnoxStatus(user.id) : null;
  // Back to the reading the reader works it from: the treasury books the
  // section's, everyone else attests their unit's.
  return (
    <InvoiceRecordClient
      data={data}
      fortnox={fortnox}
      backHref={isTreasury(user) ? invoicesHref("all") : invoicesHref("unit")}
    />
  );
}
