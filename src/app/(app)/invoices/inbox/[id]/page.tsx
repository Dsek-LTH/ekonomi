import { redirect } from "next/navigation";
import { requireUser } from "@/lib/server/current-user";
import { cleanSubject } from "@/lib/domain/inbound-mail";
import { canSeeInvoiceInbox, getInboxDocument } from "@/lib/data/invoice-inbox";
import { attestReachOf, costCenterSuggestionFor, invoiceViewerOf } from "@/lib/data/supplier-invoices";
import { getActiveCostCenters } from "@/lib/data/cost-centers";
import { readDocumentScan } from "@/lib/server/invoice-documents";
import { InvoiceMissing } from "../../[id]/record-client";
import { DocumentAllocateClient } from "./allocate-client";

// Fördela a document in the unit's Inkorg: the unit's step, and the one that
// makes it an invoice. The same form an invoice is fördelad again on
// (../../[id]/allocate), reached from the Inkorg and from the mail the unit
// was sent when it was given the document.
//
// The PDF is read here, the first time anybody needs what it says. What it
// says is only offered: the unit has the document beside the form.
export default async function DocumentAllocatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  if (!canSeeInvoiceInbox(user)) redirect("/dashboard");
  const doc = await getInboxDocument(id, user);
  if (!doc) return <InvoiceMissing />;
  if (!doc.can.canAllocate) redirect(`/invoices/inbox?doc=${id}`);

  const [reading, viewer, costCenters] = await Promise.all([
    readDocumentScan(id),
    invoiceViewerOf(user),
    getActiveCostCenters(),
  ]);
  const scanned = reading.fields;
  const suggestedCostCenter = await costCenterSuggestionFor({
    id,
    resultUnitId: doc.resultUnitId,
    supplierName: reading.supplier?.name ?? null,
    yourReference: scanned.reference ?? null,
    inboundMail: { note: doc.note, subject: doc.subject, originalFrom: doc.originalFrom },
  });

  return (
    <DocumentAllocateClient
      document={doc}
      title={cleanSubject(doc.subject) ?? doc.filename}
      suggestedCostCenter={suggestedCostCenter}
      costCenters={costCenters}
      reach={attestReachOf(viewer)}
      defaults={{
        amount: scanned.amount == null ? null : scanned.amount / 100,
        // What triage entered when sending it, failing that the PDF.
        dueDate: doc.dueDate || scanned.dueDate || "",
        description: cleanSubject(doc.subject) ?? "",
      }}
      fromScan={{ amount: scanned.amount != null, dueDate: !doc.dueDate && Boolean(scanned.dueDate) }}
    />
  );
}
