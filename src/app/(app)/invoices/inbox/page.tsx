import { redirect } from "next/navigation";
import { requireUser } from "@/lib/server/current-user";
import { canSeeInvoiceInbox, getInboxDocuments, getInboxMail } from "@/lib/data/invoice-inbox";
import { getAssignableResultUnits, getInboxHealth } from "@/lib/data/supplier-invoices";
import { canAccessSettings, canTriageInvoices } from "@/lib/domain/permissions";
import { InkorgClient } from "./inkorg-client";
import { titled } from "@/lib/server/page-title";

export const generateMetadata = titled("invoiceInbox");

export default async function InvoiceInboxPage({
  searchParams,
}: {
  searchParams: Promise<{ doc?: string }>;
}) {
  const user = await requireUser();
  if (!canSeeInvoiceInbox(user)) redirect("/dashboard");
  const triage = canTriageInvoices(user.capabilities);
  const { doc } = await searchParams;
  const [documents, resultUnits, health] = await Promise.all([
    getInboxDocuments(user),
    triage ? getAssignableResultUnits() : [],
    triage ? getInboxHealth() : null,
  ]);
  const selected = documents.find((d) => d.id === doc) ?? null;
  const mail = selected?.mailed ? await getInboxMail(selected.id, user) : null;
  return (
    <InkorgClient
      documents={documents}
      selected={selected}
      mail={mail}
      resultUnits={resultUnits}
      health={health}
      triage={triage}
      canConnectMailbox={canAccessSettings(user.capabilities)}
    />
  );
}
