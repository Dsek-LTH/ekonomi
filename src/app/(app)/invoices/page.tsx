import { requirePage } from "@/lib/server/current-user";
import { getInvoiceRows } from "@/lib/data/supplier-invoices";
import type { SearchParams } from "@/lib/data/list-query";
import { canSeeInvoices, canTriageInvoices, canViewBookkeeping } from "@/lib/domain/permissions";
import { ownedResultUnits } from "@/lib/server/result-units";
import { getFiscalYear } from "@/lib/server/fiscal-year";
import { InvoicesClient } from "./invoices-client";
import { INVOICE_TABS, invoiceDefaultTab, type InvoiceScope, type InvoiceTab } from "./scope";

// Fakturor: every levfaktura the reader may see, from the moment it is given
// to a unit until it is in Fortnox, with the stage as a tab. See
// docs/navigation.md.
//
// It used to be the booking half only, with the attest half on Att attestera
// beside the utlägg. That left an invoice sitting with its unit listed nowhere
// under Leverantörsfakturor at all. Both halves are tabs here now, and the
// resultatansvarig reads the same list on their own units.
export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requirePage(canSeeInvoices);
  const params = await searchParams;
  const owned = await ownedResultUnits(user);

  // Narrowest first, as the track draws them. A scope that is not the
  // reader's is answered with the one they would have landed on, as on Utlägg.
  const scopes: InvoiceScope[] = [
    ...(owned.names.length > 0 ? (["unit"] as const) : []),
    ...(canViewBookkeeping(user.capabilities) || canTriageInvoices(user.capabilities)
      ? (["all"] as const)
      : []),
  ];
  // An attester who answers for no unit (an admin, say) still has the page,
  // and reads it as the section's: that is what they attest on.
  if (scopes.length === 0) scopes.push("all");
  const scope = scopes.find((s) => s === params.scope) ?? scopes[scopes.length - 1];
  const tab: InvoiceTab =
    INVOICE_TABS.find((t) => t === params.tab) ?? invoiceDefaultTab(scope);

  const [rows, fiscal] = await Promise.all([
    getInvoiceRows(user, { ownUnits: scope === "unit" }),
    getFiscalYear(),
  ]);
  // Keyed by scope: the table holds its tab in state, and a new scope is a
  // new reading of the list rather than the old one re-cut.
  return <InvoicesClient key={scope} rows={rows} scope={scope} scopes={scopes} tab={tab} fiscal={fiscal} />;
}
