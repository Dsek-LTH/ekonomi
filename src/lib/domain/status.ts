import { daysAgo, isCompleteDate, isFutureDate } from "@/lib/domain/date";
import type { ExpenseStatus, PaymentType } from "@/lib/domain/types";

// Days a member has to hand in an eget utlägg, counted inclusively from the purchase day (60 days
// old is in time, 61 is not). Not for sektionskort purchases: those show on the bank statement
// and must be accounted for however late. Milersättning counts as eget utlägg, using the
// latest journey day (lib/mileage/claim.ts).
export const REIMBURSEMENT_DEADLINE_DAYS = 60;

/** Payment types the section pays back to a member. The deadline and the payout account both hang on this. */
const OUT_OF_POCKET: readonly PaymentType[] = ["REIMBURSEMENT", "MILEAGE"];

export const isOutOfPocket = (paymentType: PaymentType): boolean =>
  OUT_OF_POCKET.includes(paymentType);

export function isLateReimbursement(purchaseDate: string, paymentType: PaymentType): boolean {
  return (
    isOutOfPocket(paymentType) &&
    isCompleteDate(purchaseDate) &&
    daysAgo(purchaseDate) > REIMBURSEMENT_DEADLINE_DAYS
  );
}

type SubmitCandidate = {
  title: string;
  purchaseDate: string;
  grossAmount: number; // SEK, negative for a return
  paymentType: PaymentType;
  matchedTransactionId?: string;
  submitterHasPayout: boolean;
  /** Whether there is a receipt. Not its id: the wizard holds the file in the browser until the utlägg is saved. */
  hasReceipt: boolean;
  /** For milersättning, why the journey cannot be sent yet (`claimBlocker`, lib/mileage/claim.ts), or null. Passed in because domain/ knows no rate tables. */
  mileageBlocker?: string | null;
  /** Whether the filing deadline was waived for this claim (`canWaiveFilingDeadline`). Separate from `isLateReimbursement`: a waived utlägg is still late. The wizard passes false. */
  deadlineWaived: boolean;
  allocations: { amount: number; costCenterCode: string }[];
};

// Why an expense can't be sent for attest yet, or null when it's ready. Mirrors the server-side
// check in the transition route.
export type SubmitBlocker =
  "match" | "payout" | "receipt" | "mileage" | "incomplete" | "futureDate" | "tooLate";

export function submitBlocker(e: SubmitCandidate): SubmitBlocker | null {
  // First, ahead of everything the submitter could still fix: past the filing deadline there is
  // nothing to fix. A dispens (skattmästare accepts this one late utlägg) changes only this line.
  if (isLateReimbursement(e.purchaseDate, e.paymentType) && !e.deadlineWaived) {
    return "tooLate";
  }
  if (e.paymentType === "CARD" && !e.matchedTransactionId) return "match";
  if (isOutOfPocket(e.paymentType) && !e.submitterHasPayout) return "payout";
  // A milersättning has no receipt: its journey is typeset from the odometer readings, so that
  // is what is checked here.
  if (e.paymentType === "MILEAGE") {
    if (e.mileageBlocker) return "mileage";
  } else if (!e.hasReceipt) {
    // The receipt is the underlag bokföringslagen wants kept, and an attester has nothing to attest without it.
    return "receipt";
  }
  // A return is negative, so the amount is only missing when it's zero or NaN, which `!` covers.
  // A half-typed date ("2026", "2026-07") counts as missing.
  if (!e.title.trim() || !isCompleteDate(e.purchaseDate) || !e.grossAmount) return "incomplete";
  // The date is whole but still in the future.
  if (isFutureDate(e.purchaseDate)) return "futureDate";
  if (e.allocations.length === 0) return "incomplete";
  // Every row has to name a cost centre.
  if (e.allocations.some((a) => !a.costCenterCode.trim())) return "incomplete";
  const sum = e.allocations.reduce((s, a) => s + a.amount, 0);
  if (Math.abs(sum - e.grossAmount) > 0.005) return "incomplete";
  return null;
}

/** An utlägg is editable only while in the submitter's own hands, so not while out for attest (an attester must not see it change). Recall first. Kept separate from SUBMITTABLE_STATUSES on purpose. */
export const EDITABLE_STATUSES: ExpenseStatus[] = ["DRAFT", "CHANGES_REQUESTED"];

export const isEditable = (status: string): boolean =>
  EDITABLE_STATUSES.includes(status as ExpenseStatus);

// Pre-attest statuses: the owner may still send (or re-send) these for attest.
export const SUBMITTABLE_STATUSES: ExpenseStatus[] = ["DRAFT", "CHANGES_REQUESTED"];

export const isSubmittable = (status: string): boolean =>
  SUBMITTABLE_STATUSES.includes(status as ExpenseStatus);

// "Attested or further": once here, only an admin may delete the utlägg.
export const SIGNED_STATUSES: ExpenseStatus[] = ["APPROVED", "BOOKED", "EXPORTED"];

export const isSigned = (status: string): boolean =>
  SIGNED_STATUSES.includes(status as ExpenseStatus);

// An attester may pull their own attest back until the utlägg is bokfört (APPROVED drops back to PENDING_APPROVAL).
const ATTEST_WITHDRAWABLE_STATUSES: ExpenseStatus[] = ["PENDING_APPROVAL", "APPROVED"];

export const isAttestWithdrawable = (status: string): boolean =>
  ATTEST_WITHDRAWABLE_STATUSES.includes(status as ExpenseStatus);

/** Whether the submitter may take their utlägg out of the attest queue. Only while waiting; pulling back a fully attested one is `return_approved`. Not `isAttestWithdrawable`. */
export const isRecallable = (status: string): boolean =>
  (status as ExpenseStatus) === "PENDING_APPROVAL";

/** Whether an edit-type event belongs on the timeline. Before the first submission (`reference` is null, never cleared after) a draft's saves are one act. Only the submitter's own edits are scoped out. */
export function isQuietDraftEdit(
  expense: { reference: string | null; submitterId: string },
  actorId: string,
): boolean {
  return expense.reference === null && actorId === expense.submitterId;
}

// Every status, in the order an utlägg passes through them. The utlägg list status filter offers exactly these.
export const EXPENSE_STATUSES: readonly ExpenseStatus[] = [
  "DRAFT",
  "PENDING_APPROVAL",
  "CHANGES_REQUESTED",
  "APPROVED",
  "BOOKED",
  "EXPORTED",
];

export type Tone = "neutral" | "purple" | "blue" | "accent" | "success" | "warning" | "danger";

// Six statuses, six meanings, one colour each:
//   neutral  nobody is waiting on anything yet
//   purple   waiting on the authority chain: an attestant has it
//   danger   it came back; something is wrong
//   blue     attested, waiting on the treasury
//   accent   the treasury has taken it over
//   success  settled, bokförd in Fortnox
// PENDING_APPROVAL is purple, not pink, so the commonest status does not look like a button.
export const STATUS_TONE: Record<ExpenseStatus, Tone> = {
  DRAFT: "neutral",
  PENDING_APPROVAL: "purple",
  CHANGES_REQUESTED: "danger",
  APPROVED: "blue",
  BOOKED: "accent",
  EXPORTED: "success",
};

export const TONE_CLASSES: Record<Tone, string> = {
  neutral: "bg-surface text-muted",
  purple: "bg-purple-soft text-purple",
  blue: "bg-blue-soft text-blue",
  accent: "bg-accent-soft text-accent",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
};

/** How an utlägg was paid, as a class name pair. Separate from `TONE_CLASSES` so one colour never means two things. */
export const PAYMENT_CLASSES: Record<PaymentType, string> = {
  CARD: "border-pay-card/30 bg-pay-card-soft text-pay-card",
  REIMBURSEMENT: "border-pay-private/30 bg-pay-private-soft text-pay-private",
  MILEAGE: "border-pay-mileage/30 bg-pay-mileage-soft text-pay-mileage",
};

/** The same hues for a standalone icon. Written out literally: Tailwind cannot generate `text-pay-${type}`. */
export const PAYMENT_TEXT: Record<PaymentType, string> = {
  CARD: "text-pay-card",
  REIMBURSEMENT: "text-pay-private",
  MILEAGE: "text-pay-mileage",
};
