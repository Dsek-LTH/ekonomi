// Counts beside nav links, in the header's räkenskapsår so a count never promises rows the list
// hides. Same rows as the dashboard queue (lib/domain/queue.ts).
import "server-only";

import type { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/server/db";
import { fiscalYearWhere, type During } from "@/lib/server/fiscal-year";
import { inFiscalYear, type FiscalYear } from "@/lib/ui/fiscal-year";
import { canBookkeep, canSeeInvoices, hasAttestRole } from "@/lib/domain/permissions";
import { attestScopeWhere } from "./attest-scope";
import { countCardlessTransactions, countUnaccountedPurchases } from "./bank";
import { canSeeInvoiceInbox, countInboxDocuments } from "./invoice-inbox";
import { getInvoiceRows } from "./supplier-invoices";
import type { Viewer } from "./expense-scope";

export interface NavCounts {
  /** Utlägg waiting on the viewer at any stage: own sent back, to attest, and for the treasury attested and konterade. */
  expenses: number;
  /** Own card purchases with no utlägg yet; for bookkeeping, purchases on no card. */
  bank: number;
  invoiceInbox: number;
  /** Levfakturor waiting for the viewer's attest or for the treasury to export. */
  invoices: number;
}

// The three parts of the Utlägg count, shared with getExpenseTabCounts. `within` is the list's scope.
type Within = Prisma.ExpenseWhereInput;

const returnedExpenses = (viewer: Viewer, during: During | undefined, within: Within = {}) =>
  prisma.expense.count({
    where: {
      AND: [
        within,
        { submitterId: viewer.id, status: "CHANGES_REQUESTED" },
        during ? { purchaseDate: during } : {},
      ],
    },
  });

const attestableExpenses = (viewer: Viewer, during: During | undefined, within: Within = {}) =>
  hasAttestRole(viewer.capabilities)
    ? attestScopeWhere(viewer, { ownUnits: true }).then((scope) =>
        prisma.expense.count({
          where: {
            AND: [
              within,
              scope,
              { status: "PENDING_APPROVAL" },
              during ? { purchaseDate: during } : {},
            ],
          },
        }),
      )
    : Promise.resolve(0);

const treasuryExpenses = (
  viewer: Viewer,
  status: "APPROVED" | "BOOKED",
  during: During | undefined,
  within: Within = {},
) =>
  canBookkeep(viewer.capabilities)
    ? prisma.expense.count({
        where: { AND: [within, { status }, during ? { purchaseDate: during } : {}] },
      })
    : Promise.resolve(0);

/** What waits on the reader under each of Utlägg's tabs, at the scope the list is read at. */
export async function getExpenseTabCounts(
  viewer: Viewer,
  scope: "mine" | "unit" | "all",
  year: FiscalYear | null,
): Promise<Partial<Record<"draft" | "attest" | "book" | "export", number>>> {
  const during = year ? fiscalYearWhere(year) : undefined;
  const within: Within =
    scope === "mine"
      ? { submitterId: viewer.id }
      : scope === "unit"
        ? await attestScopeWhere(viewer, { ownUnits: true })
        : {};
  const [draft, attest, book, exp] = await Promise.all([
    returnedExpenses(viewer, during, within),
    attestableExpenses(viewer, during, within),
    treasuryExpenses(viewer, "APPROVED", during, within),
    treasuryExpenses(viewer, "BOOKED", during, within),
  ]);
  return { draft, attest, book, export: exp };
}

export async function getNavCounts(viewer: Viewer, year: FiscalYear | null): Promise<NavCounts> {
  const during = year ? fiscalYearWhere(year) : undefined;
  const invoiceRows = canSeeInvoices(viewer.capabilities)
    ? getInvoiceRows(viewer)
    : Promise.resolve([]);
  const [returned, bank, cardless, attest, approved, booked, invoiceInbox, rows] =
    await Promise.all([
      // Only what came back, not drafts (a draft is left off on purpose).
      returnedExpenses(viewer, during),
      countUnaccountedPurchases(viewer.id, { during }),
      canBookkeep(viewer.capabilities) ? countCardlessTransactions({ during }) : 0,
      attestableExpenses(viewer, during),
      treasuryExpenses(viewer, "APPROVED", during),
      treasuryExpenses(viewer, "BOOKED", during),
      canSeeInvoiceInbox(viewer) ? countInboxDocuments(viewer) : 0,
      // Rows, not a count: invoiceWaitsOn decides per row, so the badge and the list cannot disagree.
      invoiceRows,
    ]);
  return {
    expenses: returned + attest + approved + booked,
    bank: bank + cardless,
    invoiceInbox,
    // Dated as the Fakturor list does (invoiceYearDate in app/(app)/invoices/scope.ts).
    invoices: rows.filter(
      (r) => r.waitsOnViewer && (!year || inFiscalYear(year, r.invoiceDate || r.receivedAt)),
    ).length,
  };
}
