// Leverantörsfakturor: what state an invoice can be in, what it needs before it
// can go for attest, and who may do what with it.
//
// Pure, like the rest of domain/. The database is asked in lib/data and in the
// routes, and what they found is handed in here, so every rule below can be
// read, and tested, without one.
//
// Who may *attest* an allocation is not decided here. It is the same question
// it is for an utlägg, about the cost centre's result unit, and it is answered
// by the same function (canAttestAllocation in permissions.ts). An invoice has
// no submitter claiming money, so the "never your own" clause never applies:
// the resultatansvarig who konterade it is exactly who is expected to sign it.
import { canBookkeep, canTriageInvoices, isAdmin } from "./permissions";
import type { Tone } from "./status";
import type { Capability, Role, SupplierInvoiceStatus } from "./types";

/** Every status, in the order an invoice passes through them. */
export const INVOICE_STATUSES: readonly SupplierInvoiceStatus[] = [
  "INBOX",
  "ASSIGNED",
  "PENDING_APPROVAL",
  "CHANGES_REQUESTED",
  "APPROVED",
  "EXPORTED",
  "DISCARDED",
];

/**
 * How each status reads, in the colours an utlägg's do (STATUS_TONE): neutral
 * while nobody is waiting on anything in particular, purple with an attestant,
 * danger when it came back, success when it is through. The inkorg is accent,
 * the treasury's colour, because it is the treasury's to sort.
 */
export const INVOICE_STATUS_TONE: Record<SupplierInvoiceStatus, Tone> = {
  INBOX: "accent",
  ASSIGNED: "neutral",
  PENDING_APPROVAL: "purple",
  CHANGES_REQUESTED: "danger",
  APPROVED: "success",
  EXPORTED: "success",
  DISCARDED: "neutral",
};

/**
 * Where the kontering can still be changed. The inkorg is among them so that
 * triage can fill in what the invoice says while deciding whose it is, and so
 * that whoever it lands with finds the supplier and the amount already there.
 */
const EDITABLE: readonly SupplierInvoiceStatus[] = ["INBOX", "ASSIGNED", "CHANGES_REQUESTED"];
export const isInvoiceEditable = (s: SupplierInvoiceStatus): boolean => EDITABLE.includes(s);

/** Where it can be sent for attest from: given to somebody, and not yet sent. */
const SUBMITTABLE: readonly SupplierInvoiceStatus[] = ["ASSIGNED", "CHANGES_REQUESTED"];
export const isInvoiceSubmittable = (s: SupplierInvoiceStatus): boolean =>
  SUBMITTABLE.includes(s);

/** Where triage can still give it to somebody else, or take it back. Once it
 *  has gone for attest, moving it would move it out from under a signature. */
const ASSIGNABLE: readonly SupplierInvoiceStatus[] = ["INBOX", "ASSIGNED", "CHANGES_REQUESTED"];
export const isInvoiceAssignable = (s: SupplierInvoiceStatus): boolean =>
  ASSIGNABLE.includes(s);

/** Where it can be discarded from. The same set: nothing on its way to being
 *  paid is thrown away. */
export const isInvoiceDiscardable = isInvoiceAssignable;

// ── Before it goes for attest ─────────────────────────────────────

export interface SubmitFacts {
  supplierName: string | null;
  dueDate: Date | string | null;
  amount: number | null; // öre
  documentCount: number;
  allocations: readonly { amount: number; account: string }[];
}

/**
 * Why this invoice cannot be sent for attest yet, as an error code under
 * `errors.supplierInvoice`, or null when it can.
 *
 * The first thing missing, not all of them: the form shows every field, so
 * the one that matters is the one the button is waiting for.
 *
 * Asks for the least the attest needs to mean anything. A supplier and an
 * amount, because that is what is being signed for; a due date, because an
 * invoice that is attested and then sits past it costs the section a
 * påminnelseavgift; the PDF, because the attester signs for what it says; and
 * a kontering that adds up, with an account on every row, because that is
 * what goes to Fortnox. The invoice number, OCR and bankgiro are wanted in
 * Fortnox but not by the attest, and are asked for at export instead.
 */
export function submitBlocker(f: SubmitFacts): string | null {
  if (f.documentCount === 0) return "supplierInvoice.noDocument";
  if (!f.supplierName?.trim()) return "supplierInvoice.noSupplier";
  if (!f.amount || f.amount <= 0) return "supplierInvoice.noAmount";
  if (!f.dueDate) return "supplierInvoice.noDueDate";
  if (f.allocations.length === 0) return "supplierInvoice.noAllocations";
  if (f.allocations.some((a) => !a.account.trim())) return "supplierInvoice.allocationNoAccount";
  if (f.allocations.some((a) => a.amount <= 0)) return "supplierInvoice.allocationNotPositive";
  const sum = f.allocations.reduce((s, a) => s + a.amount, 0);
  if (sum !== f.amount) return "supplierInvoice.allocationSumMismatch";
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
  /** Whether each allocation is attested, and whether this viewer may attest
   *  it. Worked out per row by the caller with canAttestAllocation. */
  allocations: readonly { approved: boolean; viewerMayAttest: boolean }[];
}

/**
 * Whether the viewer konterar this invoice: the resultatansvarig of the unit it
 * was given to. Triage and the admins may also do it, triage so that an
 * invoice can be konterad on the spot when whoever sorts it already knows, and
 * the admins because they may attest anything and so may fix anything.
 */
export function konterarInvoice(viewer: InvoiceViewer, invoice: InvoiceFacts): boolean {
  if (isAdmin(viewer.capabilities) || canTriageInvoices(viewer.capabilities)) return true;
  return invoice.resultUnitId !== null && viewer.ownedResultUnitIds.includes(invoice.resultUnitId);
}

export interface InvoiceCapabilities {
  /** Change what the invoice says and how it is konterad. */
  canEdit: boolean;
  /** Add and remove the PDF behind it. The same rule as canEdit. */
  canEditDocuments: boolean;
  /** Give it to a result unit, move it, or take it back to the inkorg. */
  canAssign: boolean;
  canDiscard: boolean;
  canRestore: boolean;
  canSubmit: boolean;
  /** Take it back out of the attest, to change something. */
  canRecall: boolean;
  /** Sign the allocations this viewer may attest that are not signed yet. */
  canApprove: boolean;
  /** Send it back with a comment: from the attest by an attester, or once
   *  attested by the treasury, which is the last to look at it before Fortnox. */
  canRequestChanges: boolean;
}

/** Everything the detail page needs to know about what this viewer may do. */
export function invoiceCapabilities(
  viewer: InvoiceViewer,
  invoice: InvoiceFacts,
): InvoiceCapabilities {
  const triage = canTriageInvoices(viewer.capabilities);
  const konterar = konterarInvoice(viewer, invoice);
  const s = invoice.status;

  // In the inkorg it is nobody's yet, so only triage may touch it.
  const canEdit = isInvoiceEditable(s) && (s === "INBOX" ? triage : konterar);

  const mayAttestSome = invoice.allocations.some((a) => a.viewerMayAttest);
  const pendingMine = invoice.allocations.some((a) => a.viewerMayAttest && !a.approved);

  return {
    canEdit,
    canEditDocuments: canEdit,
    canAssign: triage && isInvoiceAssignable(s),
    canDiscard: triage && isInvoiceDiscardable(s),
    canRestore: triage && s === "DISCARDED",
    canSubmit: konterar && isInvoiceSubmittable(s),
    canRecall: konterar && s === "PENDING_APPROVAL",
    canApprove: s === "PENDING_APPROVAL" && pendingMine,
    canRequestChanges:
      (s === "PENDING_APPROVAL" && mayAttestSome) ||
      (s === "APPROVED" && canBookkeep(viewer.capabilities)),
  };
}

/**
 * Whether the viewer is waiting on this invoice: it is theirs to kontera, or
 * theirs to sign, or (for triage) it is in the inkorg. What the "Att göra" tab
 * is made of.
 */
export function invoiceWaitsOn(
  viewer: InvoiceViewer,
  invoice: InvoiceFacts,
): boolean {
  const s = invoice.status;
  if (s === "INBOX") return canTriageInvoices(viewer.capabilities);
  if (isInvoiceSubmittable(s)) {
    // The unit's own people, not everyone who could step in. Triage and the
    // admins may kontera anything, and a list of everything is not a to-do.
    return invoice.resultUnitId !== null && viewer.ownedResultUnitIds.includes(invoice.resultUnitId);
  }
  if (s === "PENDING_APPROVAL") {
    return invoice.allocations.some((a) => a.viewerMayAttest && !a.approved);
  }
  return false;
}
