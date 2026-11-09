// Request bodies for everything under /api/supplier-invoices.
import { z } from "zod";
import { MAX_ROUNDING, ocrDigits } from "@/lib/domain/supplier-invoice";
import { Clearable, Id, IsoDate, Ore, Trimmed } from "./common";

/** Free text off the invoice: trimmed, capped, and clearable. */
const Text = (max: number) => Clearable(Trimmed.max(max)).optional();

/** Öresutjämning in öre, either sign, under a krona. See costTotal. */
const Rounding = Clearable(z.number().int().min(-MAX_ROUNDING).max(MAX_ROUNDING)).optional();

/** A BAS account is four digits; whether Fortnox has it is checked at export. */
const AccountNumber = Trimmed.regex(/^\d{4}$/);

/**
 * One row of the unit's fördelning: a cost centre, and its share when split. A single row carries no amount. See attestBlocker.
 */
export const KonteringRow = z.object({
  costCenterCode: Trimmed.min(1),
  amount: Clearable(Ore).optional(),
  comment: Clearable(Trimmed.max(200)).optional(),
});
export type KonteringRow = z.infer<typeof KonteringRow>;

/** One line of the treasury's kontering, öre. See SupplierInvoiceLine. */
export const InvoiceLine = z.object({
  account: AccountNumber,
  costCenterCode: Clearable(Trimmed.max(20)).optional(),
  project: Clearable(Trimmed.max(20)).optional(),
  description: Clearable(Trimmed.max(100)).optional(),
  debit: Ore.min(0),
  credit: Ore.min(0),
});
export type InvoiceLine = z.infer<typeof InvoiceLine>;

/**
 * PATCH /api/supplier-invoices/[id]: the treasurer's kontering, a field at a time. Absent means "leave it". Lines are
 * sent whole and replace the saved ones; the fördelning is sent with its attest instead.
 */
export const PatchSupplierInvoice = z.object({
  description: Text(200),
  supplierName: Text(120),
  supplierOrgNo: Text(20),
  invoiceNumber: Text(40),
  invoiceDate: Clearable(IsoDate).optional(),
  dueDate: Clearable(IsoDate).optional(),
  amount: Clearable(Ore).optional(),
  /** Öresutjämning in öre, either sign, under a krona. */
  rounding: Rounding,
  /** Saved as digits alone; whether Fortnox accepts it is asked at Spara (exportBlocker). */
  ocr: Clearable(Trimmed.max(40).transform((v) => ocrDigits(v) || null)).optional(),
  bankgiro: Text(20),
  plusgiro: Text(20),
  /** "Er referens" as printed, corrected. Fortnox's YourReference. */
  yourReference: Text(50),
  /** "Vår referens". Fortnox's OurReference. */
  ourReference: Text(50),
  /** The supplier in Fortnox's register, as picked at the export step. */
  fortnoxSupplierNumber: Text(20),
  lines: z.array(InvoiceLine).max(50).optional(),
});
export type PatchSupplierInvoice = z.infer<typeof PatchSupplierInvoice>;

/**
 * POST /api/supplier-invoices/[id]/transition. `attest` carries the fördelning when the invoice is waiting for one, and
 * nothing when another unit is signing its share. `request_changes` requires a comment (checked by the route).
 * Returning to the Inkorg is ../return and sending to Fortnox is ../export.
 */
export const TransitionSupplierInvoice = z.object({
  action: z.enum([
    "assign",
    "attest",
    "withdraw_attest",
    "redistribute",
    "book",
    "request_changes",
  ]),
  resultUnitId: Id.optional(),
  rows: z.array(KonteringRow).min(1).max(20).optional(),
  /** With the fördelning: the amount it is split against, öre, as the unit
   *  read it off the invoice. */
  amount: Ore.optional(),
  /** With the fördelning: the öresutjämning, which the split adds up to the
   *  amount without. Absent keeps what the invoice has. */
  rounding: Rounding,
  /** With the fördelning: the due date, as the unit read it. */
  dueDate: IsoDate.optional(),
  /** With the fördelning: what the invoice is for, in a line. */
  description: Text(200),
  comment: Trimmed.max(1000).optional(),
});
export type TransitionSupplierInvoice = z.infer<typeof TransitionSupplierInvoice>;

/** POST /api/supplier-invoices: a document in a unit's Inkorg, fördelad, which makes it an invoice. */
export const CreateSupplierInvoice = z.object({
  documentId: Id,
  rows: z.array(KonteringRow).min(1).max(20),
  /** The amount it is split against, öre, as the unit read it off the invoice. */
  amount: Ore,
  /** The öresutjämning, which the split adds up to the amount without. */
  rounding: Rounding,
  /** The due date, as the unit read it. */
  dueDate: IsoDate,
  /** What the invoice is for, in a line. */
  description: Text(200),
  comment: Trimmed.max(1000).optional(),
});
export type CreateSupplierInvoice = z.infer<typeof CreateSupplierInvoice>;

/** POST /api/supplier-invoice-documents/[id]/assign: to a unit's Inkorg, with
 *  the due date when triage read one. Absent leaves it as it was. */
export const AssignInvoiceDocument = z.object({
  resultUnitId: Id,
  dueDate: Clearable(IsoDate).optional(),
});

/** POST /api/supplier-invoice-documents/[id]/decline: the unit's "Inte vår". */
export const DeclineInvoiceDocument = z.object({ reason: Trimmed.min(1).max(500) });

/** POST /api/supplier-invoices/[id]/return: back to the Inkorg, and why. */
export const ReturnSupplierInvoice = z.object({ reason: Trimmed.min(1).max(500) });
export type ReturnSupplierInvoice = z.infer<typeof ReturnSupplierInvoice>;
