// Leverantörsfakturor: what state an invoice can be in, what each step needs,
// and who may do what with it.
//
// Pure, like the rest of domain/. The database is asked in lib/data and in the
// routes, and what they found is handed in here, so every rule below can be
// read, and tested, without one.
//
// The work is split by who knows what, in the steps an utlägg goes through.
// The resultatansvarig knows what the invoice was for and where the cost
// belongs, so they fördelar it (cost centres, and the amount and due date it is
// split against) and sign their own rows in the same step. The treasurer knows
// the supplier register and the chart of accounts, so the rest (supplier,
// invoice number, OCR, account) is theirs: konterad first, then sent to
// Fortnox as an act of its own. Neither is asked the other's question.
//
// Who may *attest* a row is not decided here. It is the same question it is
// for an utlägg, about the cost centre's result unit, answered by the same
// function (canAttestAllocation in permissions.ts). An invoice has no submitter
// claiming money, so the "never your own" clause never applies.
import { canBookkeep, canTriageInvoices, isAdmin } from "./permissions";
import type { Tone } from "./status";
import type { Capability, Role, SupplierInvoiceStatus } from "./types";

/** The leverantörsskuld account, BAS standard. What every supplier invoice's
 *  total is credited to until it is paid. */
export const PAYABLE_ACCOUNT = 2440;

/** Öres- och kronutjämning, BAS standard: where an invoice's rounding goes. */
export const ROUNDING_ACCOUNT = 3740;

/** The most an öresutjämning may be, in öre, either way: under a krona. */
export const MAX_ROUNDING = 99;

/**
 * The cost rows as booked, in öre, when the invoice carries an öresutjämning.
 *
 * The split is attested against the amount to pay, which is what the rows
 * add up to. The rounding is the difference between that and what the
 * invoice's lines came to, booked on its own account: `rounding` öre debited
 * there (credited when negative). So the cost booked is the amount to pay
 * less the rounding, and the difference is taken on the largest share, where
 * an öre or two is least of it. The first of equals, so it is the same row
 * every time.
 */
export function bookedShares(shares: readonly number[], rounding: number): number[] {
  if (!rounding || shares.length === 0) return [...shares];
  const largest = shares.reduce((best, s, i) => (s > shares[best] ? i : best), 0);
  return shares.map((s, i) => (i === largest ? s - rounding : s));
}

/** Every status, in the order an invoice passes through them. */
export const INVOICE_STATUSES: readonly SupplierInvoiceStatus[] = [
  "ASSIGNED",
  "PENDING_APPROVAL",
  "CHANGES_REQUESTED",
  "APPROVED",
  "BOOKED",
  "EXPORTED",
];

/**
 * How each status reads, in the colours an utlägg's do (STATUS_TONE): neutral
 * while it waits on its unit, purple while another unit still has to sign,
 * danger when it came back, blue once attested, accent once the treasury has
 * konterat it, success when it is in Fortnox.
 */
export const INVOICE_STATUS_TONE: Record<SupplierInvoiceStatus, Tone> = {
  ASSIGNED: "neutral",
  PENDING_APPROVAL: "purple",
  CHANGES_REQUESTED: "danger",
  APPROVED: "blue",
  BOOKED: "accent",
  EXPORTED: "success",
};

/** Attested by every unit, and with the treasury: to kontera, or konterad and
 *  waiting to be sent. */
const WITH_TREASURY: readonly SupplierInvoiceStatus[] = ["APPROVED", "BOOKED"];
export const isWithTreasury = (s: SupplierInvoiceStatus): boolean => WITH_TREASURY.includes(s);

/** Waiting for its unit to fördela it again, which signs the unit's own rows
 *  too. The first fördelning is of a document, which it makes an invoice. */
const ATTESTABLE: readonly SupplierInvoiceStatus[] = ["ASSIGNED", "CHANGES_REQUESTED"];
export const awaitsAllocation = (s: SupplierInvoiceStatus): boolean => ATTESTABLE.includes(s);

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
export const isInvoiceReturnable = awaitsAllocation;

// ── The attest ────────────────────────────────────────────────────

export interface AttestRow {
  amount: number | null; // öre
}

/**
 * Why this fördelning cannot be attested, as an error code under
 * `errors.supplierInvoice`, or null when it can.
 *
 * One row needs no amount: it is the whole invoice, whatever that comes to.
 * Two or more name their shares, every one of them, and when the invoice's
 * total is already known (read from the PDF, or typed by the treasurer) the
 * shares must come to it. When it is not known yet, the kontering checks the
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
  /** Öresutjämning, öre, signed. Booked on its own account at the export. */
  rounding: number | null;
  /** The attested split's shares, öre. Null for the one row of an unsplit
   *  invoice, which is the whole of it. */
  shares: readonly (number | null)[];
  /** The treasury's kontering, öre. See SupplierInvoiceLine. */
  lines: readonly { account: string; debit: number; credit: number }[];
}

/**
 * Why the treasurer cannot kontera it yet, or null when they can, asked again
 * when it is sent. What Fortnox needs to make a supplier invoice it can pay:
 * whose it is, which invoice, when it is due, how much, and a kontering that
 * books exactly that much. A split's shares must come to the total too: they
 * are what the units signed for, and only the unit can change them.
 */
export function exportBlocker(f: ExportFacts): string | null {
  if (!f.fortnoxSupplierNumber) return "supplierInvoice.noSupplier";
  if (!f.invoiceNumber?.trim()) return "supplierInvoice.noInvoiceNumber";
  if (!f.invoiceDate) return "supplierInvoice.noInvoiceDate";
  if (!f.dueDate) return "supplierInvoice.noDueDate";
  if (!f.amount || f.amount <= 0) return "supplierInvoice.noAmount";
  if (f.shares.length > 1) {
    const sum = f.shares.reduce<number>((s, a) => s + (a ?? 0), 0);
    if (sum !== f.amount) return "supplierInvoice.allocationSumMismatch";
  }
  if (f.lines.length === 0) return "supplierInvoice.noLines";
  if (f.lines.some((l) => !l.account.trim())) return "supplierInvoice.lineNoAccount";
  if (f.lines.some((l) => l.debit < 0 || l.credit < 0 || (l.debit === 0) === (l.credit === 0))) {
    return "supplierInvoice.lineNoAmount";
  }
  // The lines and the rounding together book the amount to pay, which is
  // what the leverantörsskuld is credited with.
  const booked = f.lines.reduce((s, l) => s + l.debit - l.credit, 0) + (f.rounding ?? 0);
  if (booked !== f.amount) return "supplierInvoice.unbalanced";
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
  /** Fördela it (cost centres, amount, due date, what it is for) and sign the
   *  rows the viewer may attest, one step. Also open to triage and the admins,
   *  who may do it on the unit's behalf. For triage without the attest right
   *  it sends the invoice to the unit's attesters. */
  canAllocate: boolean;
  /** Sign the rows this viewer may attest on an invoice waiting for them. */
  canAttest: boolean;
  /** Send it back to the Inkorg, with a reason: the unit's "Inte vår", or
   *  triage taking it back. See isInvoiceReturnable. */
  canReturnToInbox: boolean;
  /** Take your own signature back, before it reaches Fortnox. */
  canWithdrawAttest: boolean;
  /** Reopen the split while other units are still signing: every signature
   *  comes off and it is the unit's to kontera again. The unit's (or
   *  triage's), since the split is theirs to propose. A signature is on the
   *  split as it stood, so changing the split asks everyone again. */
  canRedistribute: boolean;
  /** Send it back to the unit with a comment: by another unit's attester
   *  while it waits on them, or by the treasury once it is attested. */
  canRequestChanges: boolean;
  /** Give it to another result unit instead. Triage's. */
  canMove: boolean;
  /** Kontera it: supplier, amount, dates, OCR, and the account on each row.
   *  The bookkeeping treasurers', once every row is attested and until it is
   *  in Fortnox. */
  canBook: boolean;
  /** Send the konterade invoice to Fortnox. */
  canSend: boolean;
  /** Add and remove the PDF behind it. */
  canEditDocuments: boolean;
}

/** Everything the page needs to know about what this viewer may do. */
export function invoiceCapabilities(
  viewer: InvoiceViewer,
  invoice: InvoiceFacts,
): InvoiceCapabilities {
  const triage = canTriageInvoices(viewer.capabilities);
  const bookkeeper = canBookkeep(viewer.capabilities);
  const s = invoice.status;
  const owner = ownsUnit(viewer, invoice);

  const allocate =
    awaitsAllocation(s) && (owner || triage || isAdmin(viewer.capabilities));
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

// ── A document in an Inkorg ───────────────────────────────────────

/** What the viewer may do with a document no invoice has yet. */
export interface DocumentCapabilities {
  /** See it at all: triage and the admins every one, a resultatansvarig the
   *  ones given to their units. */
  canSee: boolean;
  /** Give it to a result unit, or to another one. Triage's. */
  canAssign: boolean;
  /** Fördela it, which makes it an invoice. The unit's, and triage's and the
   *  admins' on the unit's behalf, as for an invoice. Only once it has a
   *  unit: the fördelning is the unit's cost centres. */
  canAllocate: boolean;
  /** "Inte vår": back to triage, with a reason. The unit's. */
  canDecline: boolean;
  /** Delete it for good. Triage's. */
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

/** Where the viewer's work on an invoice stands. */
export type InvoiceQueue =
  | "attest" // waiting for this viewer's attest
  | "export" // attested, for the treasury to kontera and send
  | "elsewhere" // waiting on somebody else
  | "done"; // in Fortnox

export function invoiceQueue(viewer: InvoiceViewer, invoice: InvoiceFacts): InvoiceQueue {
  const s = invoice.status;
  if (s === "EXPORTED") return "done";
  if (isWithTreasury(s)) return canBookkeep(viewer.capabilities) ? "export" : "elsewhere";
  // The unit's own people, not everyone who could step in. Triage and the
  // admins may fördela anything, and a list of everything is not a to-do.
  if (awaitsAllocation(s)) return ownsUnit(viewer, invoice) ? "attest" : "elsewhere";
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
