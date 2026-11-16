import { getBoardMembers } from "@/lib/data/board";
import { canBookkeep, canViewBookkeeping } from "@/lib/domain/permissions";
import { requirePage } from "@/lib/server/current-user";
import { previewBoardInvoices } from "@/lib/server/board-invoices";
import { getFiscalYear } from "@/lib/server/fiscal-year";
import { titled } from "@/lib/server/page-title";
import { fiscalYearLabel } from "@/lib/ui/fiscal-year";

import InvoicesClient from "./invoices-client";

export const generateMetadata = titled("boardInvoices");

// Fakturering: one row per person with a tab, and the year-end invoices. Read by the bookkeepers, run by the treasury.
export default async function BoardInvoicesPage() {
  const user = await requirePage(canViewBookkeeping);
  // The year picked in the header is the year the invoices are for.
  const year = await getFiscalYear();
  const [members, invoices] = await Promise.all([
    getBoardMembers(),
    year ? previewBoardInvoices(year) : [],
  ]);

  return (
    <InvoicesClient
      members={members}
      invoices={invoices}
      yearLabel={year ? fiscalYearLabel(year) : null}
      canManage={canBookkeep(user.capabilities)}
    />
  );
}
