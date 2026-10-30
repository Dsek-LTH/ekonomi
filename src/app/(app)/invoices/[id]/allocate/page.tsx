import { redirect } from "next/navigation";
import { requirePage } from "@/lib/server/current-user";
import { canSeeInvoices } from "@/lib/domain/permissions";
import { cleanSubject } from "@/lib/domain/inbound-mail";
import { getInvoice } from "@/lib/data/supplier-invoices";
import { readInvoiceScan } from "@/lib/server/invoice-documents";
import { loadWorkspace } from "../../load";
import { InvoiceMissing } from "../record-client";
import { InvoiceAllocateClient } from "./allocate-client";

// Fördela a levfaktura: the unit's step, as editing an utlägg is the
// submitter's. Which cost centres take how much, and the amount, due date and
// description it is split against. Sent, the unit's own rows are signed with
// it, and the reader is back on the record. Only while the invoice waits for
// it; otherwise the record says where it stands.
//
// The PDF is read here, the first time anybody needs what it says. What it
// says is only offered: the unit has the invoice beside the form.
export default async function InvoiceAllocatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePage(canSeeInvoices);
  // Whether it is theirs to fördela before anything is read off its PDF.
  const found = await getInvoice(id, user);
  if (!found) return <InvoiceMissing />;
  if (!found.can.canAllocate) redirect(`/invoices/${id}`);

  const reading = await readInvoiceScan(id);
  const data = await loadWorkspace(id, user, reading);
  if (!data) return <InvoiceMissing />;
  const { invoice } = data;
  const scanned = reading.fields;

  // What the form opens on: what the invoice already says (a fördelning sent
  // back keeps what was sent), failing that what the PDF says, and for the
  // description the subject of the mail it was forwarded in.
  const defaults = {
    amount: invoice.amount ?? (scanned.amount == null ? null : scanned.amount / 100),
    dueDate: invoice.dueDate || scanned.dueDate || "",
    description: invoice.description ?? cleanSubject(invoice.mail?.subject) ?? "",
  };
  const fromScan = {
    amount: invoice.amount == null && scanned.amount != null,
    dueDate: !invoice.dueDate && Boolean(scanned.dueDate),
  };
  return <InvoiceAllocateClient data={data} defaults={defaults} fromScan={fromScan} />;
}
