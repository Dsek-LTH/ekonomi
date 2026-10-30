import { redirect } from "next/navigation";
import { requirePage } from "@/lib/server/current-user";
import { canBookkeep } from "@/lib/domain/permissions";
import { loadWorkspace } from "../../load";
import { InvoiceMissing } from "../record-client";
import { InvoiceBookClient } from "./book-client";

// Kontera a levfaktura, as an utlägg's kontering is: the treasury completes it
// from the PDF and Fortnox's supplier register and saves it. Sending it to
// Fortnox is a separate act, on the record. Only once every share is attested
// and until it is sent; otherwise the record says where it stands.
export default async function InvoiceBookPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePage(canBookkeep);
  const data = await loadWorkspace(id, user);
  if (!data) return <InvoiceMissing />;
  if (!data.can.canBook) redirect(`/invoices/${id}`);
  return <InvoiceBookClient data={data} />;
}
