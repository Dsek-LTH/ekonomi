import { redirect } from "next/navigation";
import { requireUser } from "@/lib/server/current-user";
import { canSeeInvoiceInbox, getInboxDocuments } from "@/lib/data/invoice-inbox";
import { getAssignableResultUnits, getInboxHealth } from "@/lib/data/supplier-invoices";
import { canTriageInvoices } from "@/lib/domain/permissions";
import { ownedResultUnits } from "@/lib/server/result-units";
import { InkorgClient } from "./inkorg-client";

// The levfaktura Inkorg: every document no invoice has yet. Where forwarded
// PDFs and hand uploads land, and where the documents of an invoice sent back
// return to. Triage gives each to a result unit, or deletes it. A unit's
// resultatansvarig reads the same page narrowed to what was given to them,
// and fördelar each, which makes it an invoice, or says it is not theirs.
export default async function InvoiceInboxPage({ searchParams }: { searchParams: Promise<{ doc?: string }> }) {
  const user = await requireUser();
  if (!canSeeInvoiceInbox(user)) redirect("/dashboard");
  const triage = canTriageInvoices(user.capabilities);
  const { doc } = await searchParams;
  const [documents, resultUnits, health, owned] = await Promise.all([
    getInboxDocuments(user),
    triage ? getAssignableResultUnits() : [],
    triage ? getInboxHealth() : null,
    ownedResultUnits(user),
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
      triage={triage}
      ownsUnits={owned.names.length > 0}
    />
  );
}
