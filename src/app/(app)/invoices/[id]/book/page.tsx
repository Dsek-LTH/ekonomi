import { redirect } from "next/navigation";
import { requirePage } from "@/lib/server/current-user";
import { canBookkeep } from "@/lib/domain/permissions";
import { loadInvoiceFor } from "@/lib/api/supplier-invoice-access";
import { invoiceCoverFacts } from "@/lib/server/invoice-cover";
import { loadWorkspace } from "../../load";
import { InvoiceMissing } from "../record-client";
import { InvoiceBookClient } from "./book-client";
import { titled } from "@/lib/server/page-title";

export const generateMetadata = titled("bookInvoice");

export default async function InvoiceBookPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePage(canBookkeep);
  const data = await loadWorkspace(id, user);
  if (!data) return <InvoiceMissing />;
  if (!data.can.canBook) redirect(`/invoices/${id}`);
  // What the attest page says as saved, for the browser to draw live with the kontering's edits laid over it.
  const access = await loadInvoiceFor(user, id);
  const cover = access.ok ? await invoiceCoverFacts(access.invoice) : null;
  return <InvoiceBookClient data={data} cover={cover} />;
}
