import { redirect } from "next/navigation";
import { requirePage } from "@/lib/server/current-user";
import { canBookkeep } from "@/lib/domain/permissions";
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
  return <InvoiceBookClient data={data} />;
}
