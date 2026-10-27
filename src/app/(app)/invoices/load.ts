// What a page needs to show one invoice's workspace, loaded the same way
// whichever page shows it: the inbox's right-hand pane, the one-at-a-time
// view, or a link from a mail.
import "server-only";

import {
  attestReachOf,
  getAssignableResultUnits,
  getInvoice,
  invoiceViewerOf,
} from "@/lib/data/supplier-invoices";
import { getActiveCostCenters } from "@/lib/data/cost-centers";
import { getActiveAccounts } from "@/lib/data/accounts";
import { canBookkeep, canTriageInvoices } from "@/lib/domain/permissions";
import type { Viewer } from "@/lib/data/expense-scope";
import type { WorkspaceProps } from "./workspace";

export type WorkspaceData = Omit<WorkspaceProps, "onDone" | "header">;

/** Whether the viewer works the invoices as the treasury does: the inbox,
 *  rather than the one-at-a-time view. */
export const isTreasury = (v: Viewer) => canTriageInvoices(v.capabilities) || canBookkeep(v.capabilities);

export async function loadWorkspace(id: string, viewer: Viewer): Promise<WorkspaceData | null> {
  const found = await getInvoice(id, viewer);
  if (!found) return null;
  const { invoice, can } = found;

  // The pickers only for someone who can use them. A page ships what it asks
  // for, and nobody reading an attested invoice needs a few hundred cost
  // centres. What the invoice already points at is kept in, retired or not.
  const [ctx, costCenters, accounts, resultUnits] = await Promise.all([
    invoiceViewerOf(viewer),
    can.canKontera ? getActiveCostCenters(invoice.allocations.map((a) => a.costCenterCode)) : [],
    can.canEditDetails
      ? getActiveAccounts(invoice.allocations.flatMap((a) => (a.account ? [a.account] : [])))
      : [],
    can.canAssign ? getAssignableResultUnits() : [],
  ]);

  return { invoice, can, reach: attestReachOf(ctx), costCenters, accounts, resultUnits };
}
