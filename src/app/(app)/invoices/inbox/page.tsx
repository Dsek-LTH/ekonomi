import { requirePage } from "@/lib/server/current-user";
import { getInboxDocuments } from "@/lib/data/invoice-inbox";
import { getAssignableResultUnits, getInboxHealth } from "@/lib/data/supplier-invoices";
import { canTriageInvoices } from "@/lib/domain/permissions";
import { fiscalYearWhere, getFiscalYear } from "@/lib/server/fiscal-year";
import { InkorgClient } from "./inkorg-client";

// The levfaktura Inkorg: every document no invoice has yet. Where forwarded
// PDFs and hand uploads land, and where a document taken off an invoice comes
// back to. Triage makes an invoice from each, or deletes it.
export default async function InvoiceInboxPage({
  searchParams,
}: {
  searchParams: Promise<{ doc?: string }>;
}) {
  await requirePage(canTriageInvoices);
  const { doc } = await searchParams;
  // The räkenskapsår, by when each document arrived. See docs/navigation.md.
  const fiscal = await getFiscalYear();
  const [documents, resultUnits, health] = await Promise.all([
    getInboxDocuments({ during: fiscal ? fiscalYearWhere(fiscal) : undefined }),
    getAssignableResultUnits(),
    getInboxHealth(),
  ]);
  // Only one asked for: the list opens with nothing open, and the document
  // panel comes when a row is clicked.
  const selected = documents.find((d) => d.id === doc) ?? null;
  return (
    <InkorgClient
      documents={documents}
      selected={selected}
      resultUnits={resultUnits}
      health={health}
    />
  );
}
