// Request bodies for everything under /api/supplier-invoices.
//
// Shared with the pages, so the shape a screen sends and the shape the route
// accepts are one definition. See lib/api/parse.ts.
import { z } from "zod";
import { MAX_ROUNDING } from "@/lib/domain/supplier-invoice";
import { Clearable, Id, IsoDate, Ore, Trimmed } from "./common";

/** Free text off the invoice: trimmed, capped, and clearable. */
const Text = (max: number) => Clearable(Trimmed.max(max)).optional();

/** A BAS account is four digits. Whether Fortnox has it is Fortnox's to say
 *  at export, the same as for a voucher booked here. */
const AccountNumber = Trimmed.regex(/^\d{4}$/);

/**
 * One row of the unit's fördelning: a cost centre, and its share when the
 * invoice is split. One row on its own carries no amount, being the whole
 * invoice. See attestBlocker.
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
 * PATCH /api/supplier-invoices/[id]: the treasurer's kontering, a field at a
 * time.
 *
 * Every field optional, because this patches: absent means "leave it". Not
 * the fördelning, which is the unit's and is sent with its attest. The
 * kontering's lines are sent whole, and replace whatever was saved.
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
  rounding: Clearable(z.number().int().min(-MAX_ROUNDING).max(MAX_ROUNDING)).optional(),
  ocr: Text(40),
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
 * POST /api/supplier-invoices/[id]/transition.
 *
 * `assign` moves it to another result unit. `attest` carries the fördelning
 * when the invoice is waiting for one, and nothing when another unit is
 * signing its share of a split. `redistribute` reopens a split while other
 * units are still signing it. `book` marks the treasury's kontering done,
 * once what is saved is enough to send. `request_changes` requires a comment,
 * which the route checks: it is the only thing the person it goes back to has
 * to go on. Sending it back to the Inkorg is its own route (../return), and
 * sending it to Fortnox is ../export.
 */
export const TransitionSupplierInvoice = z.object({
  action: z.enum(["assign", "attest", "withdraw_attest", "redistribute", "book", "request_changes"]),
  resultUnitId: Id.optional(),
  rows: z.array(KonteringRow).min(1).max(20).optional(),
  /** With the fördelning: the amount it is split against, öre, as the unit
   *  read it off the invoice. */
  amount: Ore.optional(),
  /** With the fördelning: the due date, as the unit read it. */
  dueDate: IsoDate.optional(),
  /** With the fördelning: what the invoice is for, in a line. */
  description: Text(200),
  comment: Trimmed.max(1000).optional(),
});
export type TransitionSupplierInvoice = z.infer<typeof TransitionSupplierInvoice>;

/**
 * POST /api/supplier-invoices: a document in a unit's Inkorg, fördelad, which
 * is what makes it an invoice. The same fördelning an invoice sent back is
 * given again through `attest` above.
 */
export const CreateSupplierInvoice = z.object({
  documentId: Id,
  rows: z.array(KonteringRow).min(1).max(20),
  /** The amount it is split against, öre, as the unit read it off the invoice. */
  amount: Ore,
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
