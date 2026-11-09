// Leverantörsfakturor: invoice states, what each step needs, and who may do what. Pure like the rest
// of domain/. The resultatansvarig fördelar (cost centres, amount, due date) and signs their rows;
// the treasurer konterar, then sends to Fortnox. Attest authority is canAttestAllocation in
// permissions.ts, and the "never your own" clause never applies (no submitter claiming money).
import { canBookkeep, canTriageInvoices, isAdmin } from "./permissions";
import type { Tone } from "./status";
import type { Capability, Role, SupplierInvoiceStatus } from "./types";

/** The leverantörsskuld account, BAS standard. Every invoice total is credited to it until paid. */
export const PAYABLE_ACCOUNT = 2440;

/** Öres- och kronutjämning, BAS standard: where an invoice's rounding goes. */
export const ROUNDING_ACCOUNT = 3740;

/** The most an öresutjämning may be, in öre, either way: under a krona. */
export const MAX_ROUNDING = 99;

/** What the cost rows come to, öre: the amount to pay less the öresutjämning. The rounding is booked on its own account, so the cost centres carry the lines as printed. */
export function costTotal(amount: number, rounding: number | null | undefined): number {
  return amount - (rounding ?? 0);
}

/** Whether an öresutjämning is one: whole öre, under a krona either way. */
export const isValidRounding = (ore: number): boolean =>
  Number.isInteger(ore) && Math.abs(ore) <= MAX_ROUNDING;

// Colours follow an utlägg's (STATUS_TONE).
export const INVOICE_STATUS_TONE: Record<SupplierInvoiceStatus, Tone> = {
  ASSIGNED: "neutral",
  PENDING_APPROVAL: "purple",
  CHANGES_REQUESTED: "danger",
  APPROVED: "blue",
  BOOKED: "accent",
  EXPORTED: "success",
};

/** Attested by every unit, and with the treasury: to kontera, or konterad and waiting to be sent. */
const WITH_TREASURY: readonly SupplierInvoiceStatus[] = ["APPROVED", "BOOKED"];
export const isWithTreasury = (s: SupplierInvoiceStatus): boolean => WITH_TREASURY.includes(s);

/** Waiting for its unit to fördela it again, which signs the unit's own rows too. */
const ATTESTABLE: readonly SupplierInvoiceStatus[] = ["ASSIGNED", "CHANGES_REQUESTED"];
export const awaitsAllocation = (s: SupplierInvoiceStatus): boolean => ATTESTABLE.includes(s);

/** Whether it can still be moved to another unit or sent back to the Inkorg: only while nothing on it is signed. Back to the Inkorg deletes the invoice and returns its documents. */
export const isInvoiceReturnable = awaitsAllocation;

export interface AttestRow {
  amount: number | null; // öre
}

/** Why this fördelning cannot be attested (error code under `errors.supplierInvoice`), or null. One row needs no amount. Two or more must each name a share, and when the total is known the shares must come to it less the öresutjämning (costTotal). */
export function attestBlocker(f: {
  documentCount: number;
  rows: readonly AttestRow[];
  invoiceAmount: number | null;
  /** Öresutjämning, öre, signed. */
  rounding?: number | null;
}): string | null {
  if (f.documentCount === 0) return "supplierInvoice.noDocument";
  if (f.rows.length === 0) return "supplierInvoice.noAllocations";
  if (f.rows.length === 1) return null;
  if (f.rows.some((r) => r.amount == null || r.amount <= 0)) {
    return "supplierInvoice.splitNeedsAmounts";
  }
  const sum = f.rows.reduce((s, r) => s + (r.amount ?? 0), 0);
  if (f.invoiceAmount != null && sum !== costTotal(f.invoiceAmount, f.rounding)) {
    return "supplierInvoice.allocationSumMismatch";
  }
  return null;
}

/** An OCR number as Fortnox takes it: digits alone (printed invoices group them with spaces and dashes). */
export function ocrDigits(ocr: string): string {
  return ocr.replace(/[\s-]/g, "");
}

/** Whether Fortnox will take it as an OCR: 2 to 25 digits with a valid modulus 10 check digit. Checked at Spara so the export never meets Fortnox's refusal. */
export function isValidOcr(ocr: string): boolean {
  const digits = ocrDigits(ocr);
  if (!/^\d{2,25}$/.test(digits)) return false;
  // From the right: every second digit doubled, its digits summed.
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) d = d * 2 > 9 ? d * 2 - 9 : d * 2;
    sum += d;
  }
  return sum % 10 === 0;
}

export interface ExportFacts {
  fortnoxSupplierNumber: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | Date | null;
  dueDate: string | Date | null;
  amount: number | null; // öre
  ocr: string | null;
  rounding: number | null;
  /** The attested split's shares, öre. Null for the one row of an unsplit invoice. */
  shares: readonly (number | null)[];
  /** The treasury's kontering, öre. See SupplierInvoiceLine. */
  lines: readonly { account: string; debit: number; credit: number }[];
}

/** Why the treasurer cannot kontera it yet, or null; asked again when it is sent. A split's shares must come to the total less the öresutjämning too, since only the unit can change them. */
export function exportBlocker(f: ExportFacts): string | null {
  if (!f.fortnoxSupplierNumber) return "supplierInvoice.noSupplier";
  if (!f.invoiceNumber?.trim()) return "supplierInvoice.noInvoiceNumber";
  if (!f.invoiceDate) return "supplierInvoice.noInvoiceDate";
  if (!f.dueDate) return "supplierInvoice.noDueDate";
  if (!f.amount || f.amount <= 0) return "supplierInvoice.noAmount";
  if (f.ocr && !isValidOcr(f.ocr)) return "supplierInvoice.badOcr";
  if (f.shares.length > 1) {
    const sum = f.shares.reduce<number>((s, a) => s + (a ?? 0), 0);
    if (sum !== costTotal(f.amount, f.rounding)) return "supplierInvoice.allocationSumMismatch";
  }
  if (f.lines.length === 0) return "supplierInvoice.noLines";
  if (f.lines.some((l) => !l.account.trim())) return "supplierInvoice.lineNoAccount";
  if (f.lines.some((l) => l.debit < 0 || l.credit < 0 || (l.debit === 0) === (l.credit === 0))) {
    return "supplierInvoice.lineNoAmount";
  }
  // The lines and the rounding together book the amount to pay.
  const booked = f.lines.reduce((s, l) => s + l.debit - l.credit, 0) + (f.rounding ?? 0);
  if (booked !== f.amount) return "supplierInvoice.unbalanced";
  return null;
}

/** `ownedResultUnitIds` is empty for anyone without RESULTATANSVARIG (ownedResultUnits in lib/server/result-units.ts). */
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
  /** Per row: whether it is signed, by whom, and whether this viewer may sign it (canAttestAllocation). */
  allocations: readonly {
    approved: boolean;
    approvedById?: string | null;
    viewerMayAttest: boolean;
  }[];
}

const ownsUnit = (viewer: InvoiceViewer, invoice: InvoiceFacts) =>
  invoice.resultUnitId !== null && viewer.ownedResultUnitIds.includes(invoice.resultUnitId);

export interface InvoiceCapabilities {
  /** Fördela it and sign the rows the viewer may attest, in one step. Also open to triage and the admins on the unit's behalf. */
  canAllocate: boolean;
  canAttest: boolean;
  /** Send it back to the Inkorg, with a reason. See isInvoiceReturnable. */
  canReturnToInbox: boolean;
  canWithdrawAttest: boolean;
  /** Reopen the split while other units are signing: every signature comes off, since a signature is on the split as it stood. */
  canRedistribute: boolean;
  /** Send it back to the unit with a comment: by another unit's attester while it waits, or by the treasury once attested. */
  canRequestChanges: boolean;
  canMove: boolean;
  /** Kontera it: supplier, amount, dates, OCR and the account on each row. Bookkeeping, once every row is attested and until it is in Fortnox. */
  canBook: boolean;
  canSend: boolean;
  canEditDocuments: boolean;
}

export function invoiceCapabilities(
  viewer: InvoiceViewer,
  invoice: InvoiceFacts,
): InvoiceCapabilities {
  const triage = canTriageInvoices(viewer.capabilities);
  const bookkeeper = canBookkeep(viewer.capabilities);
  const s = invoice.status;
  const owner = ownsUnit(viewer, invoice);

  const allocate = awaitsAllocation(s) && (owner || triage || isAdmin(viewer.capabilities));
  const pendingMine = invoice.allocations.some((a) => a.viewerMayAttest && !a.approved);
  const signedByMe = invoice.allocations.some((a) => a.approvedById === viewer.id);

  return {
    canAllocate: allocate,
    canAttest: s === "PENDING_APPROVAL" && pendingMine,
    canReturnToInbox: isInvoiceReturnable(s) && (owner || triage),
    canWithdrawAttest: (s === "PENDING_APPROVAL" || isWithTreasury(s)) && signedByMe,
    canRedistribute: s === "PENDING_APPROVAL" && (owner || triage),
    canRequestChanges:
      (s === "PENDING_APPROVAL" && pendingMine) || (isWithTreasury(s) && bookkeeper),
    canMove: triage && isInvoiceReturnable(s),
    canBook: bookkeeper && isWithTreasury(s),
    canSend: bookkeeper && s === "BOOKED",
    // The PDF is what is attested, so it is fixed once anybody has signed.
    canEditDocuments: allocate,
  };
}

export interface DocumentCapabilities {
  /** See it at all: triage and the admins every one, a resultatansvarig the ones given to their units. */
  canSee: boolean;
  canAssign: boolean;
  /** Fördela it, which makes it an invoice. Only once it has a unit. */
  canAllocate: boolean;
  canDecline: boolean;
  canDelete: boolean;
}

export function documentCapabilities(
  viewer: InvoiceViewer,
  doc: { resultUnitId: string | null },
): DocumentCapabilities {
  const triage = canTriageInvoices(viewer.capabilities);
  const admin = isAdmin(viewer.capabilities);
  const owner = doc.resultUnitId !== null && viewer.ownedResultUnitIds.includes(doc.resultUnitId);
  return {
    canSee: triage || admin || owner,
    canAssign: triage,
    canAllocate: doc.resultUnitId !== null && (owner || triage || admin),
    canDecline: owner,
    canDelete: triage,
  };
}

export type InvoiceQueue =
  | "attest" // waiting for this viewer's attest
  | "export" // attested, for the treasury to kontera and send
  | "elsewhere" // waiting on somebody else
  | "done"; // in Fortnox

export function invoiceQueue(viewer: InvoiceViewer, invoice: InvoiceFacts): InvoiceQueue {
  const s = invoice.status;
  if (s === "EXPORTED") return "done";
  if (isWithTreasury(s)) return canBookkeep(viewer.capabilities) ? "export" : "elsewhere";
  // The unit's own people only: a list of everything triage could fördela is not a to-do.
  if (awaitsAllocation(s)) return ownsUnit(viewer, invoice) ? "attest" : "elsewhere";
  return invoice.allocations.some((a) => a.viewerMayAttest && !a.approved) ? "attest" : "elsewhere";
}

export const invoiceWaitsOn = (viewer: InvoiceViewer, invoice: InvoiceFacts): boolean => {
  const q = invoiceQueue(viewer, invoice);
  return q === "attest" || q === "export";
};

/** Whole days from `today` until `dueDate`, negative once passed, null with no due date. Both `YYYY-MM-DD`. */
export function daysUntilDue(dueDate: string | null, today: string): number | null {
  if (!dueDate) return null;
  const ms = Date.parse(`${dueDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}
