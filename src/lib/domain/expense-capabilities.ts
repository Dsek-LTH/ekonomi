// Which actions the detail page offers for one expense, to one viewer. Pure and React-free, derived
// once on the server so the client holds no second copy of the API's rules.
import {
  canBookkeep,
  canLogInToFortnox,
  canSendReminders,
  canUnexport,
  canWaiveFilingDeadline,
  isAdmin,
} from "@/lib/domain/permissions";
import {
  isAttestWithdrawable,
  isEditable,
  isLateReimbursement,
  isRecallable,
  isSigned,
  isSubmittable,
  submitBlocker,
  type SubmitBlocker,
} from "./status";
import { canRemindAboutExpense } from "./reminders";
import { namedStops } from "@/lib/mileage/claim";
import type { Capability, Expense, Role } from "./types";

export type ExpenseCapabilities = {
  canSubmit: boolean;
  /** Why submitting isn't possible yet, as a key under `expenses.submitBlocker`. Shown only to someone who could submit. */
  submitBlocker: SubmitBlocker | null;
  canApprove: boolean;
  canWithdrawAttest: boolean;
  withdrawableAllocationIds: string[];
  /** The submitter may take the whole utlägg back to a draft, so the claim itself can be corrected (an attester cannot do that). Not `canWithdrawAttest`. */
  canRecall: boolean;
  canRequestChanges: boolean;
  canReturn: boolean;
  canBook: boolean;
  canExport: boolean;
  /** May take an exported utlägg back to bokförd (our record only, the Fortnox voucher stays). */
  canUnexport: boolean;
  canEditVerification: boolean;
  canEdit: boolean;
  /** May grant this late utlägg a dispens. Only for a claim that is late, still in the submitter's hands, and without a dispens (canWaiveFilingDeadline). */
  canWaiveDeadline: boolean;
  canRevokeDeadlineWaiver: boolean;
  canMatch: boolean;
  canDelete: boolean;
  /** May remind whoever this utlägg is waiting on, when that is not the viewer (lib/server/reminders.ts). */
  canRemind: boolean;
  hasPrimaryAction: boolean;
  hasAnyAction: boolean;
};

export function expenseCapabilities(
  expense: Expense,
  viewer: { id: string; roles: readonly Role[]; capabilities: readonly Capability[] },
): ExpenseCapabilities {
  const bookkeeper = canBookkeep(viewer.capabilities);
  const admin = isAdmin(viewer.capabilities);
  const isOwner = expense.submitterId === viewer.id;
  const submittable = isSubmittable(expense.status);
  const mayAct = isOwner || admin;
  const blocker = submitBlocker({
    ...expense,
    hasReceipt: expense.receipts.length > 0,
    // A dispens is a fact about the row, not this viewer: the submitter sees the block lift too.
    deadlineWaived: Boolean(expense.deadlineWaiver),
    // A milersättning is asked for its journey, not a receipt. Read off the claim, not the rate table
    // (not on this side): `km` is null until the readings make a journey, `orePerKm` until one was
    // valued, which is what claimBlocker refuses on. The route is checked too: the transition route
    // refuses a claim without it.
    mileageBlocker:
      expense.paymentType === "MILEAGE" &&
      (expense.mileage?.km == null ||
        expense.mileage.orePerKm == null ||
        namedStops(expense.mileage.stops).length < 2)
        ? "incomplete"
        : null,
  });

  const canSubmit = submittable && mayAct && !blocker;
  // The dispens. `submittable` is the same set of statuses the transition route holds the grant to.
  const mayWaive =
    canWaiveFilingDeadline(viewer.capabilities) &&
    submittable &&
    isLateReimbursement(expense.purchaseDate, expense.paymentType);
  const waived = Boolean(expense.deadlineWaiver);
  const canApprove =
    expense.status === "PENDING_APPROVAL" &&
    expense.allocations.some((a) => a.canAttest && !a.approvedById);
  // Mirrors the server rule: your own signature, on a row you may still attest, before booking.
  const withdrawableAllocationIds = isAttestWithdrawable(expense.status)
    ? expense.allocations
        .filter((a) => a.canAttest && a.approvedById === viewer.id)
        .map((a) => a.id)
    : [];
  const canWithdrawAttest = withdrawableAllocationIds.length > 0;
  // Whoever may send it may take it back; an admin can do either on somebody's behalf.
  const canRecall = isRecallable(expense.status) && mayAct;
  const canReturn = !!expense.canReturn && expense.status === "APPROVED";
  const canBook = bookkeeper && expense.status === "APPROVED";
  // Exporting is a Fortnox call under the bookkeeper's own login, so it takes the narrower set that
  // has one (the chair counts as bookkeeping but has no Fortnox account).
  const canExport = canLogInToFortnox(viewer.capabilities) && expense.status === "BOOKED";
  const mayUnexport = canUnexport(viewer.capabilities) && expense.status === "EXPORTED";
  const canRequestChanges =
    expense.status === "PENDING_APPROVAL" && expense.allocations.some((a) => a.canAttest);
  // Status and standing: a resultatansvarig sees utlägg touching their unit but may not edit them.
  // The server rule is `canEditExpense` (submitter or admin).
  const canEdit = isEditable(expense.status) && mayAct;
  // Admin may delete any utlägg; a user may delete their own unless it's attested or further.
  const canDelete = admin || (isOwner && !isSigned(expense.status));
  const canWaiveDeadline = mayWaive && !waived;
  const canRevokeDeadlineWaiver = mayWaive && waived;
  const canRemind =
    canSendReminders(viewer.capabilities) && canRemindAboutExpense(expense, viewer.id);
  // Leading when on offer: a late utlägg is the one thing anybody is waiting for.
  const hasPrimaryAction =
    canApprove || canBook || canExport || canSubmit || canReturn || canWaiveDeadline;

  return {
    canSubmit,
    submitBlocker: submittable && mayAct ? blocker : null,
    canApprove,
    canWithdrawAttest,
    withdrawableAllocationIds,
    canRecall,
    canRequestChanges,
    canReturn,
    canBook,
    canExport,
    canUnexport: mayUnexport,
    canEditVerification: bookkeeper && expense.status === "BOOKED",
    canEdit,
    canMatch: expense.paymentType === "CARD" && submittable && mayAct,
    canDelete,
    canWaiveDeadline,
    canRevokeDeadlineWaiver,
    canRemind,
    hasPrimaryAction,
    hasAnyAction:
      hasPrimaryAction ||
      canWithdrawAttest ||
      canRecall ||
      canRequestChanges ||
      canEdit ||
      canDelete ||
      mayUnexport ||
      canRevokeDeadlineWaiver ||
      canRemind,
  };
}
