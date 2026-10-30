import { redirect } from "next/navigation";

// Attesting used to be a page of its own. It is now the record's card while
// the invoice waits on the viewer, and this address, still in the mails sent
// before, leads there.
export default async function InvoiceAttestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/invoices/${id}`);
}
