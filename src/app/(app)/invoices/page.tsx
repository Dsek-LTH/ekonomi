import { requirePage } from "@/lib/server/current-user";
import { getInvoiceRows } from "@/lib/data/supplier-invoices";
import type { SearchParams } from "@/lib/data/list-query";
import { canSeeInvoices, canTriageInvoices, canViewBookkeeping } from "@/lib/domain/permissions";
import { ownedResultUnits } from "@/lib/server/result-units";
import { getFiscalYear } from "@/lib/server/fiscal-year";
import { InvoicesClient } from "./invoices-client";
import { INVOICE_TABS, invoiceDefaultTab, type InvoiceScope, type InvoiceTab } from "./scope";
import { titled } from "@/lib/server/page-title";

export const generateMetadata = titled("invoices");

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requirePage(canSeeInvoices);
  const params = await searchParams;
  const owned = await ownedResultUnits(user);

  const scopes: InvoiceScope[] = [
    ...(owned.names.length > 0 ? (["unit"] as const) : []),
    ...(canViewBookkeeping(user.capabilities) || canTriageInvoices(user.capabilities)
      ? (["all"] as const)
      : []),
  ];
  // An attester without a unit (an admin) reads it as the section's.
  if (scopes.length === 0) scopes.push("all");
  const scope = scopes.find((s) => s === params.scope) ?? scopes[scopes.length - 1];
  const tab: InvoiceTab = INVOICE_TABS.find((t) => t === params.tab) ?? invoiceDefaultTab(scope);

  const [rows, fiscal] = await Promise.all([
    getInvoiceRows(user, { ownUnits: scope === "unit" }),
    getFiscalYear(),
  ]);
  // Not keyed by scope: a remount would make the scope pill jump instead of slide.
  return <InvoicesClient rows={rows} scope={scope} scopes={scopes} tab={tab} fiscal={fiscal} />;
}
