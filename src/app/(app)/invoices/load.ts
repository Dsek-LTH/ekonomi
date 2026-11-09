import "server-only";

import {
  attestReachOf,
  getAssignableResultUnits,
  getInvoice,
  invoiceViewerOf,
} from "@/lib/data/supplier-invoices";
import { getActiveCostCenters } from "@/lib/data/cost-centers";
import { getActiveAccounts } from "@/lib/data/accounts";
import { getActiveProjects } from "@/lib/data/projects";
import { canBookkeep, canTriageInvoices } from "@/lib/domain/permissions";
import type { Viewer } from "@/lib/data/expense-scope";
import type { DocumentReading } from "@/lib/server/invoice-documents";
import type { WorkspaceProps } from "./invoice-shared";

export type WorkspaceData = Omit<WorkspaceProps, "onDone">;

export const isTreasury = (v: Viewer) =>
  canTriageInvoices(v.capabilities) || canBookkeep(v.capabilities);

export async function loadWorkspace(
  id: string,
  viewer: Viewer,
  reading?: DocumentReading,
): Promise<WorkspaceData | null> {
  const found = await getInvoice(id, viewer, reading);
  if (!found) return null;
  const { invoice, can } = found;

  // Pickers only for those who can use them. What the invoice already points at is kept, retired or not.
  const kept = [
    ...invoice.allocations.map((a) => a.costCenterCode),
    ...invoice.lines.flatMap((l) => (l.costCenterCode ? [l.costCenterCode] : [])),
  ];
  const [ctx, costCenters, accounts, projects, resultUnits] = await Promise.all([
    invoiceViewerOf(viewer),
    can.canAllocate || can.canBook ? getActiveCostCenters(kept) : [],
    can.canBook ? getActiveAccounts(invoice.lines.map((l) => l.account)) : [],
    can.canBook
      ? getActiveProjects(invoice.lines.flatMap((l) => (l.project ? [l.project] : [])))
      : [],
    can.canMove ? getAssignableResultUnits() : [],
  ]);

  return {
    invoice,
    can,
    reach: attestReachOf(ctx),
    costCenters,
    accounts,
    projects,
    resultUnits,
  };
}
