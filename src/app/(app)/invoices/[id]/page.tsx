import { requirePage } from "@/lib/server/current-user";
import { getAssignableResultUnits, getInvoice } from "@/lib/data/supplier-invoices";
import { getActiveCostCenters } from "@/lib/data/cost-centers";
import { getActiveAccounts } from "@/lib/data/accounts";
import { canSeeInvoices } from "@/lib/domain/permissions";
import { InvoiceDetailClient, InvoiceMissing } from "./invoice-client";

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePage(canSeeInvoices);

  const found = await getInvoice(id, user);
  if (!found) return <InvoiceMissing />;
  const { invoice, can } = found;

  // The pickers only for someone who can use them. A page ships what it asks
  // for, and the chart of accounts is no secret, but the cost centre and unit
  // lists are a few hundred rows nobody reading an attested invoice needs.
  // What the invoice already points at is kept in, retired or not, so it still
  // shows by name and still saves.
  const [costCenters, accounts, resultUnits] = await Promise.all([
    can.canEdit ? getActiveCostCenters(invoice.allocations.map((a) => a.costCenterCode)) : [],
    can.canEdit ? getActiveAccounts(invoice.allocations.map((a) => a.account)) : [],
    can.canAssign ? getAssignableResultUnits() : [],
  ]);

  return (
    <InvoiceDetailClient
      invoice={invoice}
      can={can}
      costCenters={costCenters}
      accounts={accounts}
      resultUnits={resultUnits}
    />
  );
}
