// Request bodies for the settings screens and the member's own profile:
// section cards, cost centres, result units and their prefixes, the Fortnox
// connection, and payout details.
import { z } from "zod";
import { Clearable, Id, NonEmpty, Trimmed, UpperCode, Year } from "./common";

/** POST /api/cards — register a section card. */
export const CreateCard = z.object({
  // The last four digits off the card, which is all the bank export gives us.
  last4: Trimmed.regex(/^\d{4}$/),
  holderId: Clearable(Id).optional(),
});
export type CreateCard = z.infer<typeof CreateCard>;

/** PATCH /api/cards/[id] — assign or unassign the holder. */
export const PatchCard = z.object({
  holderId: Clearable(Id),
});
export type PatchCard = z.infer<typeof PatchCard>;

/** POST /api/cost-centers — a LOCAL cost centre, for a dimension Fortnox has none for. */
export const CreateCostCenter = z.object({
  code: UpperCode.pipe(NonEmpty),
  name: NonEmpty,
});
export type CreateCostCenter = z.infer<typeof CreateCostCenter>;

/**
 * PATCH /api/cost-centers/[id].
 *
 * No `code`: allocations and voucher lines point at this row, and the result
 * unit that attests them is derived from the code, so it is not something a
 * rename may quietly change.
 */
export const PatchCostCenter = z.object({
  name: NonEmpty.optional(),
  active: z.boolean().optional(),
});
export type PatchCostCenter = z.infer<typeof PatchCostCenter>;

/** POST /api/result-units, PATCH /api/result-units/[id]. */
export const ResultUnitBody = z.object({
  name: NonEmpty,
});
export type ResultUnitBody = z.infer<typeof ResultUnitBody>;

/** PUT /api/result-units/[id]/owners — the whole set, not a delta. */
export const SetOwners = z.object({
  userIds: z.array(Id),
});
export type SetOwners = z.infer<typeof SetOwners>;

/** POST /api/result-units/[id]/prefixes. */
export const AddPrefix = z.object({
  value: UpperCode.pipe(NonEmpty),
});
export type AddPrefix = z.infer<typeof AddPrefix>;

/**
 * PATCH /api/profile — the member's own payout details.
 *
 * Both are clearable: somebody who has left the section's payroll should be
 * able to take their account number back out.
 */
export const PatchProfile = z.object({
  bankClearingNumber: Clearable(Trimmed).optional(),
  bankAccountNumber: Clearable(Trimmed).optional(),
});
export type PatchProfile = z.infer<typeof PatchProfile>;

/**
 * PATCH /api/fortnox/settings — the voucher series exports land in, and the two
 * accounts the payment row of every verification is posted against.
 *
 * The accounts are checked against the synced chart by the route; all this says
 * is that they were sent as something that could be one.
 */
export const FortnoxSettings = z.object({
  voucherSeries: UpperCode.pipe(NonEmpty).optional(),
  bankAccount: NonEmpty.optional(),
  memberDebtAccount: NonEmpty.optional(),
});
export type FortnoxSettings = z.infer<typeof FortnoxSettings>;

/** POST /api/fortnox/sync — pull the ledger. */
export const FortnoxSync = z.object({
  scope: z.enum(["current", "all"]).default("current"),
  year: Year.optional(),
});
export type FortnoxSync = z.infer<typeof FortnoxSync>;
