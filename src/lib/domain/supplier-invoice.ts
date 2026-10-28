// Leverantörsfakturor: what state an invoice can be in, what each step needs,
// and who may do what with it.
//
// Pure, like the rest of domain/. The database is asked in lib/data and in the
// routes, and what they found is handed in here, so every rule below can be
// read, and tested, without one.
//
// The work is split by who knows what. The resultatansvarig knows what the
// invoice was for and where the cost belongs, so they pick a cost centre and
// attest, one step. The treasurer knows the supplier register and the chart of
// accounts, so the rest (supplier, amount, dates, OCR, account) is theirs, at
// the export. Neither is asked the other's question.
//
// Who may *attest* a row is not decided here. It is the same question it is
// for an utlägg, about the cost centre's result unit, answered by the same
// function (canAttestAllocation in permissions.ts). An invoice has no submitter
// claiming money, so the "never your own" clause never applies.
import { canBookkeep, canTriageInvoices, isAdmin } from "./permissions";
import type { Tone } from "./status";
import type { Capability, Role, SupplierInvoiceStatus } from "./types";

/** Every status, in the order an invoice passes through them. */
export const INVOICE_STATUSES: readonly SupplierInvoiceStatus[] = [
  "ASSIGNED",
  "PENDING_APPROVAL",
  "CHANGES_REQUESTED",
  "APPROVED",
  "EXPORTED",
];

/**
 * How each status reads, in the colours an utlägg's do (STATUS_TONE): neutral
 * while it waits on its unit, purple while another unit still has to sign,
 * danger when it came back, success when it is through.
 */
export const INVOICE_STATUS_TONE: Record<SupplierInvoiceStatus, Tone> = {
  ASSIGNED: "neutral",
  PENDING_APPROVAL: "purple",
  CHANGES_REQUESTED: "danger",
  APPROVED: "success",
  EXPORTED: "success",
};

/** Waiting for its unit's attest, which is also its kontering. */
const ATTESTABLE: readonly SupplierInvoiceStatus[] = ["ASSIGNED", "CHANGES_REQUESTED"];
export const awaitsKontering = (s: SupplierInvoiceStatus): boolean => ATTESTABLE.includes(s);

/**
 * Where it can still be moved to another unit, or sent back to the Inkorg:
 * while nothing on it is signed. Once a row is, either would move it out from
 * under a signature.
 *
 * Back to the Inkorg means it stops being an invoice. Its documents return
 * there, with the reason it was sent back, and the invoice goes, since every
 * invoice belongs to a unit and this one has none any more. Whatever history
 * it had is from before anybody signed it.
 */
export const isInvoiceReturnable = awaitsKontering;

// ── The attest ────────────────────────────────────────────────────

export interface AttestRow {
  amount: number | null; // öre
}

/**
 * Why this kontering cannot be attested, as an error code under
 * `errors.supplierInvoice`, or null when it can.
 *
 * One row needs no amount: it is the whole invoice, whatever that comes to.
 * Two or more name their shares, every one of them, and when the invoice's
 * total is already known (read from the PDF, or typed by the treasurer) the
 * shares must come to it. When it is not known yet, the export checks the
 * same thing once it is.
 */
export function attestBlocker(f: {
  documentCount: number;
  rows: readonly AttestRow[];
  invoiceAmount: number | null;
}): string | null {
  if (f.documentCount === 0) return "supplierInvoice.noDocument";
  if (f.rows.length === 0) return "supplierInvoice.noAllocations";
  if (f.rows.length === 1) return null;
  if (f.rows.some((r) => r.amount == null || r.amount <= 0)) {
    return "supplierInvoice.splitNeedsAmounts";
  }
  const sum = f.rows.reduce((s, r) => s + (r.amount ?? 0), 0);
  if (f.invoiceAmount != null && sum !== f.invoiceAmount) {
    return "supplierInvoice.allocationSumMismatch";
  }
  return null;
}

// ── The export ────────────────────────────────────────────────────

export interface ExportFacts {
  fortnoxSupplierNumber: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | Date | null;
  dueDate: string | Date | null;
  amount: number | null; // öre
  rows: readonly { amount: number | null; account: string | null }[];
}

/**
 * Why the treasurer cannot export it yet, or null when they can. What Fortnox
 * needs to make a supplier invoice it can pay: whose it is, which invoice, when
 * it is due, how much, and an account on every row. A split's shares must come
 * to the total, the check the attest could not make while the total was unknown.
 */
export function exportBlocker(f: ExportFacts): string | null {
  if (!f.fortnoxSupplierNumber) return "supplierInvoice.noSupplier";
  if (!f.invoiceNumber?.trim()) return "supplierInvoice.noInvoiceNumber";
  if (!f.invoiceDate) return "supplierInvoice.noInvoiceDate";
  if (!f.dueDate) return "supplierInvoice.noDueDate";
  if (!f.amount || f.amount <= 0) return "supplierInvoice.noAmount";
  if (f.rows.length === 0) return "supplierInvoice.noAllocations";
  if (f.rows.some((r) => !r.account)) return "supplierInvoice.allocationNoAccount";
  if (f.rows.length > 1) {
    const sum = f.rows.reduce((s, r) => s + (r.amount ?? 0), 0);
    if (sum !== f.amount) return "supplierInvoice.allocationSumMismatch";
  }
  return null;
}

// ── Who may do what ───────────────────────────────────────────────

/** What is known about the viewer. `ownedResultUnitIds` is empty for anyone
 *  without RESULTATANSVARIG, see ownedResultUnits in lib/server/result-units.ts. */
export interface InvoiceViewer {
  id: string;
  roles: readonly Role[];
  capabilities: readonly Capability[];
  ownedResultUnitIds: readonly string[];
}

/** What is known about the invoice. */
export interface InvoiceFacts {
  status: SupplierInvoiceStatus;
  resultUnitId: string | null;
  /** Per row: whether it is signed, by whom, and whether this viewer may sign
   *  it. Worked out per row by the caller with canAttestAllocation. */
  allocations: readonly { approved: boolean; approvedById?: string | null; viewerMayAttest: boolean }[];
}

/** The resultatansvarig of the unit the invoice was given to. */
const ownsUnit = (viewer: InvoiceViewer, invoice: InvoiceFacts) =>
  invoice.resultUnitId !== null && viewer.ownedResultUnitIds.includes(invoice.resultUnitId);

export interface InvoiceCapabilities {
  /** Pick the cost centre (or split) and attest: one step. Also open to
   *  triage and the admins, who may kontera on the unit's behalf. For triage
   *  without the attest right it sends the invoice to the unit's attesters. */
  canKontera: boolean;
  /** Sign the rows this viewer may attest on an invoice waiting for them. */
  canAttest: boolean;
  /** Send it back to the Inkorg, with a reason: the unit's "Inte vår", or
   *  triage taking it back. See isInvoiceReturnable. */
  canReturnToInbox: boolean;
  /** Take your own signature back, before it reaches Fortnox. */
  canWithdrawAttest: boolean;
  /** Send it back to the unit with a comment: by another unit's attester
   *  while it waits on them, or by the treasury once it is attested. */
  canRequestChanges: boolean;
  /** Give it to another result unit instead. Triage's. */
  canMove: boolean;
  /** Complete what the invoice says: supplier, amount, dates, OCR, and the
   *  account on each row. The treasury's, until it is in Fortnox. */
  canEditDetails: boolean;
  /** Add and remove the PDF behind it. */
  canEditDocuments: boolean;
}

/** Everything the page needs to know about what this viewer may do. */
export function invoiceCapabilities(
  viewer: InvoiceViewer,
  invoice: InvoiceFacts,
): InvoiceCapabilities {
  const triage = canTriageInvoices(viewer.capabilities);
  const treasury = canBookkeep(viewer.capabilities) || triage;
  const s = invoice.status;
  const owner = ownsUnit(viewer, invoice);

  const kontera =
    awaitsKontering(s) && (owner || triage || isAdmin(viewer.capabilities));
  const pendingMine = invoice.allocations.some((a) => a.viewerMayAttest && !a.approved);
  const signedByMe = invoice.allocations.some((a) => a.approvedById === viewer.id);

  return {
    canKontera: kontera,
    canAttest: s === "PENDING_APPROVAL" && pendingMine,
    canReturnToInbox: isInvoiceReturnable(s) && (owner || triage),
    canWithdrawAttest: (s === "PENDING_APPROVAL" || s === "APPROVED") && signedByMe,
    canRequestChanges:
      (s === "PENDING_APPROVAL" && pendingMine) || (s === "APPROVED" && canBookkeep(viewer.capabilities)),
    canMove: triage && isInvoiceReturnable(s),
    canEditDetails: treasury && s !== "EXPORTED",
    // The PDF is what is attested, so it is fixed once anybody has signed.
    canEditDocuments: kontera,
  };
}

/** Where the viewer's work on an invoice stands. */
export type InvoiceQueue =
  | "attest" // waiting for this viewer's attest
  | "export" // attested, for the treasury to complete and export
  | "elsewhere" // waiting on somebody else
  | "done"; // in Fortnox

export function invoiceQueue(viewer: InvoiceViewer, invoice: InvoiceFacts): InvoiceQueue {
  const s = invoice.status;
  if (s === "EXPORTED") return "done";
  if (s === "APPROVED") return canBookkeep(viewer.capabilities) ? "export" : "elsewhere";
  // The unit's own people, not everyone who could step in. Triage and the
  // admins may kontera anything, and a list of everything is not a to-do.
  if (awaitsKontering(s)) return ownsUnit(viewer, invoice) ? "attest" : "elsewhere";
  return invoice.allocations.some((a) => a.viewerMayAttest && !a.approved) ? "attest" : "elsewhere";
}

/** Whether the viewer has something to do with this invoice. */
export const invoiceWaitsOn = (viewer: InvoiceViewer, invoice: InvoiceFacts): boolean => {
  const q = invoiceQueue(viewer, invoice);
  return q === "attest" || q === "export";
};

/** Whole days from `today` until `dueDate`, negative once it has passed, or
 *  null with no due date. Both `YYYY-MM-DD`. What the inbox warns on. */
export function daysUntilDue(dueDate: string | null, today: string): number | null {
  if (!dueDate) return null;
  const ms = Date.parse(`${dueDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}
