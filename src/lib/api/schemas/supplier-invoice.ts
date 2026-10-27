// Request bodies for everything under /api/supplier-invoices.
//
// Shared with the pages, so the shape a screen sends and the shape the route
// accepts are one definition. See lib/api/parse.ts.
import { z } from "zod";
import { Clearable, Id, IsoDate, Ore, Trimmed } from "./common";

/** Free text off the invoice: trimmed, capped, and clearable. */
const Text = (max: number) => Clearable(Trimmed.max(max)).optional();

/** A BAS account is four digits. Whether Fortnox has it is Fortnox's to say
 *  at export, the same as for a voucher booked here. */
const AccountNumber = Trimmed.regex(/^\d{4}$/);

/**
 * One row of the attester's kontering: a cost centre, and its share when the
 * invoice is split. One row on its own carries no amount, being the whole
 * invoice. See attestBlocker.
 */
export const KonteringRow = z.object({
  costCenterCode: Trimmed.min(1),
  amount: Clearable(Ore).optional(),
  comment: Clearable(Trimmed.max(200)).optional(),
});
export type KonteringRow = z.infer<typeof KonteringRow>;

/**
 * PATCH /api/supplier-invoices/[id]: the treasurer's details.
 *
 * Every field optional, because this patches: absent means "leave it". Not
 * the kontering, which is the attest's and is sent with it. What the
 * treasurer adds to the rows is the account, by row id.
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
  accounts: z
    .array(z.object({ allocationId: Id, account: Clearable(AccountNumber) }))
    .max(50)
    .optional(),
});
export type PatchSupplierInvoice = z.infer<typeof PatchSupplierInvoice>;

/**
 * POST /api/supplier-invoices/[id]/transition.
 *
 * `assign` takes a result unit, and `null` for it takes the invoice back to the
 * inkorg. `attest` carries the kontering when the invoice is waiting for one,
 * and nothing when another unit is signing its share of a split.
 * `request_changes` and `decline` require a comment, which the route checks:
 * it is the only thing the person it goes back to has to go on.
 */
export const TransitionSupplierInvoice = z.object({
  action: z.enum(["assign", "attest", "decline", "withdraw_attest", "request_changes"]),
  resultUnitId: z.union([Id, z.null()]).optional(),
  rows: z.array(KonteringRow).min(1).max(20).optional(),
  comment: Trimmed.max(1000).optional(),
});
export type TransitionSupplierInvoice = z.infer<typeof TransitionSupplierInvoice>;
