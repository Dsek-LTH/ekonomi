// Request bodies for everything under /api/supplier-invoices.
//
// Shared with the detail page, so the shape the screen sends and the shape the
// route accepts are one definition. See lib/api/parse.ts.
import { z } from "zod";
import { Clearable, Id, IsoDate, Ore, Trimmed } from "./common";

/** Free text off the invoice: trimmed, capped, and clearable. */
const Text = (max: number) => Clearable(Trimmed.max(max)).optional();

/** One konteringsrad. Amounts in öre, like the invoice's own. */
export const InvoiceAllocationInput = z.object({
  costCenterCode: Trimmed.min(1),
  // Blank is allowed through so that a half-filled row can be saved. The
  // submit is what requires an account on every row (submitBlocker). A BAS
  // account is four digits. Whether Fortnox has it is Fortnox's to say at
  // export, the same as for a voucher booked here.
  account: Trimmed.regex(/^(\d{4})?$/),
  project: Clearable(Trimmed.max(20)).optional(),
  amount: Ore,
  comment: Clearable(Trimmed.max(200)).optional(),
});
export type InvoiceAllocationInput = z.infer<typeof InvoiceAllocationInput>;

/**
 * PATCH /api/supplier-invoices/[id].
 *
 * Every field optional, because this patches: absent means "leave it". The
 * allocations are sent whole when they are sent at all, in order, the same
 * as an utlägg's: a kontering is a set of rows that add up, and "change row
 * two" is not something either end can say without agreeing which row that is.
 */
export const PatchSupplierInvoice = z.object({
  description: Text(200),
  supplierName: Text(120),
  supplierOrgNo: Text(20),
  invoiceNumber: Text(40),
  invoiceDate: Clearable(IsoDate).optional(),
  dueDate: Clearable(IsoDate).optional(),
  amount: Clearable(Ore).optional(),
  ocr: Text(40),
  bankgiro: Text(20),
  plusgiro: Text(20),
  allocations: z.array(InvoiceAllocationInput).max(50).optional(),
});
export type PatchSupplierInvoice = z.infer<typeof PatchSupplierInvoice>;

/**
 * POST /api/supplier-invoices/[id]/transition.
 *
 * `assign` takes a result unit, and `null` for it takes the invoice back to the
 * inkorg. `request_changes` requires a comment, which the route checks: it is
 * the only thing the person it goes back to has to go on.
 */
export const TransitionSupplierInvoice = z.object({
  action: z.enum([
    "assign",
    "discard",
    "restore",
    "submit",
    "recall",
    "approve",
    "request_changes",
  ]),
  resultUnitId: z.union([Id, z.null()]).optional(),
  comment: Trimmed.max(1000).optional(),
});
export type TransitionSupplierInvoice = z.infer<typeof TransitionSupplierInvoice>;
