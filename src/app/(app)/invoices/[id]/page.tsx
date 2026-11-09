import { requirePage } from "@/lib/server/current-user";
import { canSeeInvoices } from "@/lib/domain/permissions";
import { getFortnoxStatus } from "@/lib/data/fortnox";
import { isTreasury, loadWorkspace } from "../load";
import { invoicesHref } from "../scope";
import { InvoiceMissing, InvoiceRecordClient } from "./record-client";
import { titled } from "@/lib/server/page-title";

export const generateMetadata = titled("invoice");

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePage(canSeeInvoices);
  const data = await loadWorkspace(id, user);
  if (!data) return <InvoiceMissing />;
  // The user id adds their own Fortnox login to the status: sending needs both.
  const fortnox = data.can.canSend ? await getFortnoxStatus(user.id) : null;
  return (
    <InvoiceRecordClient
      data={data}
      fortnox={fortnox}
      backHref={isTreasury(user) ? invoicesHref("all") : invoicesHref("unit")}
    />
  );
}
