import { requirePage } from "@/lib/server/current-user";
import { getInvoicePage, getInvoiceWaiting } from "@/lib/data/supplier-invoices";
import { parseListQuery, type SearchParams } from "@/lib/data/list-query";
import { canSeeInvoices, canTriageInvoices, canViewBookkeeping } from "@/lib/domain/permissions";
import { ownedResultUnits } from "@/lib/server/result-units";
import { fiscalYearWhere, getFiscalYear } from "@/lib/server/fiscal-year";
import { InvoicesClient } from "./invoices-client";
import { invoiceDefaultTab, type InvoiceScope } from "./scope";
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
  const query = parseListQuery(params, { defaultTab: invoiceDefaultTab(scope) });

  // The räkenskapsår narrows every tab, by invoice date (arrival while none is read).
  const fiscal = await getFiscalYear();
  const opts = { ownUnits: scope === "unit", during: fiscal ? fiscalYearWhere(fiscal) : undefined };
  const [page, waiting] = await Promise.all([
    getInvoicePage(user, query, opts),
    getInvoiceWaiting(user, opts),
  ]);
  // Not keyed by scope: a remount would make the scope pill jump instead of slide.
  return <InvoicesClient page={page} waiting={waiting.byTab} scope={scope} scopes={scopes} />;
}
