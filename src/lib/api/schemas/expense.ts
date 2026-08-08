// Request bodies for everything under /api/expenses.
//
// Shared with the wizard and the detail page, so the shape a screen sends and
// the shape the route accepts are one definition. See lib/api/parse.ts.
import { z } from "zod";
import { Clearable, Id, IsoDate, NonEmpty, Ore, Trimmed } from "./common";

const PaymentType = z.enum(["CARD", "REIMBURSEMENT"]);

/** POST /api/expenses — opens a draft for the wizard to attach a receipt to. */
export const CreateExpense = z.object({
  // Anything other than REIMBURSEMENT used to fall through to CARD, including a
  // typo. It is one of the two or it is a bad request.
  paymentType: PaymentType.default("CARD"),
  title: Trimmed.default(""),
  matchedTransactionId: Clearable(Id).optional(),
});
export type CreateExpense = z.infer<typeof CreateExpense>;

/** One cost-centre slice of an utlägg. Amounts in öre, like the gross. */
export const AllocationInput = z.object({
  costCenterCode: Trimmed,
  amount: Ore,
  comment: Trimmed.optional(),
});
export type AllocationInput = z.infer<typeof AllocationInput>;

/**
 * PATCH /api/expenses/[id].
 *
 * Every field is optional because this patches: absent means "leave it", and
 * the route fills from the stored row. `purchaseDate` and `grossAmount` are
 * additionally clearable, since a draft is allowed to not have them yet — which
 * is why they are `Clearable` rather than merely optional, and why the two are
 * different things here.
 */
export const PatchExpense = z.object({
  title: NonEmpty.optional(),
  purchaseDate: Clearable(IsoDate).optional(),
  grossAmount: Clearable(Ore).optional(),
  paymentType: PaymentType.optional(),
  allocations: z.array(AllocationInput).optional(),
});
export type PatchExpense = z.infer<typeof PatchExpense>;

/**
 * POST /api/expenses/[id]/transition.
 *
 * The action is an enum rather than a string: an unknown one used to fall past
 * every branch to a 400 at the bottom, which worked, but meant the list of what
 * this endpoint does was something you assembled by reading it.
 */
export const TransitionExpense = z.object({
  action: z.enum([
    "submit",
    "request_changes",
    "approve",
    "withdraw_attest",
    "return_approved",
    "unexport",
  ]),
  comment: Trimmed.default(""),
});
export type TransitionExpense = z.infer<typeof TransitionExpense>;

/** POST /api/expenses/[id]/match — `null` unmatches. */
export const MatchExpense = z.object({
  transactionId: Clearable(Id),
});
export type MatchExpense = z.infer<typeof MatchExpense>;

/** One row of a verification. Debit and credit in öre, never negative. */
export const VoucherLineInput = z.object({
  account: Trimmed.default(""),
  accountName: Trimmed.default(""),
  description: Trimmed.optional(),
  costCenterCode: Clearable(Trimmed).optional(),
  debit: Ore.min(0).default(0),
  credit: Ore.min(0).default(0),
});
export type VoucherLineInput = z.infer<typeof VoucherLineInput>;

/** POST and PATCH /api/expenses/[id]/book. */
export const BookVoucher = z.object({
  lines: z.array(VoucherLineInput).default([]),
  date: IsoDate.optional(),
  description: Trimmed.optional(),
});
export type BookVoucher = z.infer<typeof BookVoucher>;
