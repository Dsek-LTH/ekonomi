// Request bodies for everything under /api/expenses.
import { z } from "zod";
import { Clearable, Id, IsoDate, NonEmpty, Ore, Trimmed, UpperCode } from "./common";
import { MAX_REMINDER_ITEMS } from "@/lib/domain/reminders";

const PaymentType = z.enum(["CARD", "REIMBURSEMENT", "MILEAGE"]);

/** POST /api/expenses: opens a draft for the wizard to attach a receipt to. */
export const CreateExpense = z.object({
  // Must be one of the three, never a fallthrough to CARD.
  paymentType: PaymentType.default("CARD"),
  title: Trimmed.default(""),
  matchedTransactionId: Clearable(Id).optional(),
});
export type CreateExpense = z.infer<typeof CreateExpense>;

/** One cost-centre slice of an utlägg. Amounts in öre, like the gross. */
const AllocationInput = z.object({
  costCenterCode: Trimmed,
  amount: Ore,
  comment: Trimmed.optional(),
});
type AllocationInput = z.infer<typeof AllocationInput>;

/**
 * A total odometer reading in kilometres (the car's lifetime figure, not the trip meter). One decimal, not negative.
 * Zero is a real reading, so these are `Clearable`: "not given yet" is null.
 */
const Odometer = z.number().min(0).max(9_999_999).multipleOf(0.1);

/** One stop on a journey. Capped because it goes on the utläggsräkning, where a paragraph breaks the page. */
const Place = Trimmed.max(120);

/** PATCH /api/expenses/[id]. Absent means "leave it"; `purchaseDate` and `grossAmount` are `Clearable` since a draft may lack them. */
export const PatchExpense = z.object({
  title: NonEmpty.optional(),
  purchaseDate: Clearable(IsoDate).optional(),
  grossAmount: Clearable(Ore).optional(),
  paymentType: PaymentType.optional(),
  allocations: z.array(AllocationInput).optional(),
  /**
   * The odometer at each end of the journey, for a milersättning. No distance or amount: the server works the claim out
   * from the difference and the rate in force (lib/mileage/claim.ts) and writes `grossAmount` from them. Clearable.
   */
  odometerStart: Clearable(Odometer).optional(),
  odometerEnd: Clearable(Odometer).optional(),
  /**
   * Every place the car stopped, in order. Sent whole (order carries the meaning); absent leaves the stored list alone.
   * Blank entries are allowed so a draft can save; `claimBlocker` counts the ones that name a place. Capped at twenty.
   */
  journeyStops: z.array(Place).max(20).optional(),
});
export type PatchExpense = z.infer<typeof PatchExpense>;

/** POST /api/expenses/[id]/transition. The action is an enum so the list of what this endpoint does is declared. */
export const TransitionExpense = z.object({
  action: z.enum([
    "submit",
    // The submitter taking their own claim back, apart from "withdraw_attest" (an attester withdrawing a signature).
    "recall",
    "request_changes",
    "approve",
    "withdraw_attest",
    "return_approved",
    "unexport",
    // Dispens från redovisningsfristen for one late eget utlägg, and taking it back. Neither moves the status, so neither
    // is in SIMPLE_TRANSITIONS.
    "waive_deadline",
    "revoke_deadline_waiver",
  ]),
  comment: Trimmed.default(""),
  // "approve" and "withdraw_attest": which of the caller's rows to sign or unsign. Left out, every row the caller may.
  allocationIds: z.array(Id).min(1).optional(),
});
export type TransitionExpense = z.infer<typeof TransitionExpense>;

/** POST /api/expenses/[id]/match: `null` unmatches. */
export const MatchExpense = z.object({
  transactionId: Clearable(Id),
});
export type MatchExpense = z.infer<typeof MatchExpense>;

/** One row of a verification. Debit and credit in öre, never negative. */
export const VoucherLineInput = z.object({
  account: Trimmed.default(""),
  accountName: Trimmed.default(""),
  // Clearable like the cost centre beside it: a row with no text sends null, and the route stores `description || null`.
  description: Clearable(Trimmed).optional(),
  costCenterCode: Clearable(Trimmed).optional(),
  project: Clearable(Trimmed).optional(),
  debit: Ore.min(0).default(0),
  credit: Ore.min(0).default(0),
});
export type VoucherLineInput = z.infer<typeof VoucherLineInput>;

/** POST and PATCH /api/expenses/[id]/book. */
export const BookVoucher = z.object({
  // The utlägg's updatedAt as the booking screen loaded it; if it has moved, the write is a 409 instead of overwriting.
  expectedUpdatedAt: z.iso.datetime(),
  lines: z.array(VoucherLineInput).default([]),
  date: IsoDate.optional(),
  description: Trimmed.optional(),
  // Why the date differs from the utlägg's own. Required exactly when it does,
  // since the utlägg is then corrected to match. See lib/domain/correction.ts.
  correctionReason: Trimmed.optional(),
});
export type BookVoucher = z.infer<typeof BookVoucher>;

/**
 * PUT /api/expenses/[id]/presence: the booking screen's or review's heartbeat. `active` is false once the user is idle.
 * `screen` defaults to the booking screen.
 */
export const PresenceHeartbeat = z.object({
  active: z.boolean(),
  screen: z.enum(["book", "review"]).default("book"),
});
export type PresenceHeartbeat = z.infer<typeof PresenceHeartbeat>;

/**
 * POST /api/expenses/[id]/export/resolve: what somebody found in Fortnox for an export that ended without an answer.
 *   none     no voucher was made: the lock is released. A reason is required, since being wrong files it twice.
 *   exists   it was made with this series and number: recorded as exported.
 */
export const ResolveExport = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("none"), comment: NonEmpty }),
  z.object({
    outcome: z.literal("exists"),
    series: UpperCode.pipe(z.string().min(1)),
    number: z.int().positive(),
    comment: Trimmed.optional(),
  }),
]);
export type ResolveExport = z.infer<typeof ResolveExport>;

/**
 * POST /api/reminders: remind whoever each of these is waiting on (utlägg, or card purchases with no utlägg). The optional
 * message is quoted at the top of every mail.
 */
export const SendReminders = z
  .object({
    expenseIds: z.array(Id).default([]),
    transactionIds: z.array(Id).default([]),
    message: Clearable(Trimmed.max(2000)).optional(),
  })
  .refine((b) => b.expenseIds.length + b.transactionIds.length > 0, {
    message: "nothing picked",
  })
  .refine((b) => b.expenseIds.length + b.transactionIds.length <= MAX_REMINDER_ITEMS, {
    message: "too many picked",
  });
export type SendReminders = z.infer<typeof SendReminders>;

/** PUT /api/expenses/[id]/receipts/order: every document's id, in the order wanted. */
export const ReorderReceipts = z.object({
  ids: z.array(Id).min(1),
});
export type ReorderReceipts = z.infer<typeof ReorderReceipts>;
