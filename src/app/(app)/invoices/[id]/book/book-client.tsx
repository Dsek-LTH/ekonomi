"use client";

// The page around a levfaktura's kontering (../../book-view): its name and
// number, the PDF beside it, the history under it. Saved, the reader is back
// on the record, which then offers to send it to Fortnox. Sent back to the
// unit instead, the record says so.
import { PageShell } from "@/components/page-shell";
import { Card } from "@/components/ui/card";
import { ReceiptPanelSource } from "@/components/receipt/receipt-panel";
import { useProgressRouter } from "@/components/shell/route-progress";
import { BookPanel } from "../../book-view";
import { useInvoiceTitle } from "../../invoice-bits";
import { Timeline, invoiceDocuments } from "../../invoice-shared";
import type { WorkspaceData } from "../../load";

export function InvoiceBookClient({ data }: { data: WorkspaceData }) {
  const { invoice } = data;
  const router = useProgressRouter();
  const title = useInvoiceTitle();
  const record = `/invoices/${invoice.id}`;
  return (
    <PageShell
      width="content"
      title={title(invoice)}
      subtitle={[invoice.description && invoice.reference, invoice.resultUnitName].filter(Boolean).join(" - ") || undefined}
      back={record}
    >
      <ReceiptPanelSource documents={invoiceDocuments(invoice)} />
      <BookPanel {...data} onDone={() => router.push(record)} />
      <Card>
        <Timeline invoice={invoice} />
      </Card>
    </PageShell>
  );
}
