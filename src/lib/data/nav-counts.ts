// How much is waiting behind each link in the nav, for the small count beside
// it. The dashboard's queue (lib/domain/queue.ts) says the same thing about the
// same rows; this is only the number, and only counted, because the layout
// asks for it on every page and the rows themselves are not needed there.
//
// In the header's räkenskapsår, as every list the counts lead to is, so a
// count never promises rows the list then hides. See docs/navigation.md.
import "server-only";

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
  /** Utlägg waiting on the viewer, at every stage of theirs: their own sent
   *  back to fix, the ones waiting for their attest, and for the treasury
   *  the attested and konterade ones. One row, so one number. */
  expenses: number;
  /** Their own card purchases with no utlägg yet, and for bookkeeping the
   *  purchases on no card, which are theirs to place. */
  bank: number;
  /** Levfaktura documents in the Inkorg, for triage. */
  invoiceInbox: number;
  /** Levfakturor waiting for the viewer's attest, or for the treasury to
   *  export them. */
  invoices: number;
}

// The three parts of the Utlägg count, one query each, so the list's own tabs
// (getExpenseTabCounts) count exactly what the nav does.
const returnedExpenses = (viewer: Viewer, during: During | undefined) =>
  prisma.expense.count({
    where: { submitterId: viewer.id, status: "CHANGES_REQUESTED", ...(during ? { purchaseDate: during } : {}) },
  });

const attestableExpenses = (viewer: Viewer, during: During | undefined) =>
  hasAttestRole(viewer.capabilities)
    ? attestScopeWhere(viewer, { ownUnits: true }).then((scope) =>
        prisma.expense.count({
          where: { AND: [scope, { status: "PENDING_APPROVAL" }, during ? { purchaseDate: during } : {}] },
        }),
      )
    : Promise.resolve(0);

const treasuryExpenses = (viewer: Viewer, status: "APPROVED" | "BOOKED", during: During | undefined) =>
  canBookkeep(viewer.capabilities)
    ? prisma.expense.count({ where: { status, ...(during ? { purchaseDate: during } : {}) } })
    : Promise.resolve(0);

/**
 * What waits on the reader under each of Utlägg's tabs, at the scope the list
 * is read at. The same rows as the nav's count, split by where they sit: your
 * own sent back under Utkast on Mina, what you attest under Att attestera on
 * your units, and the treasury's two stages on Alla.
 */
export async function getExpenseTabCounts(
  viewer: Viewer,
  scope: "mine" | "unit" | "all",
  year: FiscalYear | null,
): Promise<Partial<Record<"draft" | "attest" | "book" | "export", number>>> {
  const during = year ? fiscalYearWhere(year) : undefined;
  if (scope === "mine") return { draft: await returnedExpenses(viewer, during) };
  if (scope === "unit") return { attest: await attestableExpenses(viewer, during) };
  const [book, exp] = await Promise.all([
    treasuryExpenses(viewer, "APPROVED", during),
    treasuryExpenses(viewer, "BOOKED", during),
  ]);
  return { book, export: exp };
}

export async function getNavCounts(viewer: Viewer, year: FiscalYear | null): Promise<NavCounts> {
  const during = year ? fiscalYearWhere(year) : undefined;
  const invoiceRows = canSeeInvoices(viewer.capabilities) ? getInvoiceRows(viewer) : Promise.resolve([]);
  const [returned, bank, cardless, attest, approved, booked, invoiceInbox, rows] = await Promise.all([
    // Only what came back, not the drafts: a draft is somewhere the member
    // left off on purpose, and a count that never goes away is one nobody
    // reads.
    returnedExpenses(viewer, during),
    countUnaccountedPurchases(viewer.id, { during }),
    canBookkeep(viewer.capabilities) ? countCardlessTransactions({ during }) : 0,
    attestableExpenses(viewer, during),
    treasuryExpenses(viewer, "APPROVED", during),
    treasuryExpenses(viewer, "BOOKED", during),
    canSeeInvoiceInbox(viewer) ? countInboxDocuments(viewer) : 0,
    // The rows rather than a count, because whether an invoice waits on the
    // viewer is invoiceWaitsOn's answer per row, and writing it again as a
    // query is how the badge and the list would come to disagree. A section's
    // open invoices are a few dozen.
    invoiceRows,
  ]);
  return {
    expenses: returned + attest + approved + booked,
    bank: bank + cardless,
    invoiceInbox,
    // Dated as the Fakturor list dates them (invoiceYearDate in
    // app/(app)/invoices/scope.ts): its own date, else when it arrived.
    invoices: rows.filter((r) => r.waitsOnViewer && (!year || inFiscalYear(year, r.invoiceDate || r.receivedAt)))
      .length,
  };
}
