// Which actions the detail page offers for one expense, to one viewer.
//
// Pure and React-free: role capabilities (lib/permissions) and status rules
// (lib/status) go in, a flat set of booleans comes out — so the page renders the
// answer rather than deriving it inline. Attest authority is the one input the
// client can't compute: the server stamps it per allocation as `a.canAttest`.
import { canBookkeep, canUnexport, isAdmin } from "@/lib/domain/permissions";
import {
  isAttestWithdrawable,
  isEditable,
  isSigned,
  isSubmittable,
  submitBlocker,
  type SubmitBlocker,
} from "@/lib/domain/status";
import type { Expense, Role } from "@/lib/domain/types";

export type ExpenseCapabilities = {
  canSubmit: boolean;
  /** Why submitting isn't possible yet — shown only to someone who could
   *  submit, as a key under `expenses.submitBlocker`. */
  submitBlocker: SubmitBlocker | null;
  canApprove: boolean;
  /** Viewer has signed at least one allocation and can still take it back. */
  canWithdrawAttest: boolean;
  canRequestChanges: boolean;
  canReturn: boolean;
  canBook: boolean;
  canExport: boolean;
  /** May take an exported utlägg back to bokförd — our record only, the Fortnox
   *  voucher stays where it is. */
  canUnexport: boolean;
  canEditVerification: boolean;
  canEdit: boolean;
  canMatch: boolean;
  canDelete: boolean;
  /** Whether any call-to-action is offered, which demotes "Redigera" to secondary. */
  hasPrimaryAction: boolean;
  /** Whether the panel offers anything at all — otherwise it says so. */
  hasAnyAction: boolean;
};

export function expenseCapabilities(
  expense: Expense,
  viewer: { id: string; roles: readonly Role[] },
): ExpenseCapabilities {
  const bookkeeper = canBookkeep(viewer.roles);
  const admin = isAdmin(viewer.roles);
  const isOwner = expense.submitterId === viewer.id;
  const submittable = isSubmittable(expense.status);
  const mayAct = isOwner || admin;
  const blocker = submitBlocker(expense);

  const canSubmit = submittable && mayAct && !blocker;
  const canApprove =
    expense.status === "PENDING_APPROVAL" &&
    expense.allocations.some((a) => a.canAttest && !a.approvedById);
  // Mirrors the server rule: your own signature, on a row you may still
  // attest, on an utlägg that hasn't been booked yet.
  const canWithdrawAttest =
    isAttestWithdrawable(expense.status) &&
    expense.allocations.some((a) => a.canAttest && a.approvedById === viewer.id);
  const canReturn = !!expense.canReturn && expense.status === "APPROVED";
  const canBook = bookkeeper && expense.status === "APPROVED";
  const canExport = bookkeeper && expense.status === "BOOKED";
  const mayUnexport = canUnexport(viewer.roles) && expense.status === "EXPORTED";
  const canRequestChanges =
    expense.status === "PENDING_APPROVAL" && expense.allocations.some((a) => a.canAttest);
  // Status *and* standing. Being allowed to see an utlägg is not being allowed
  // to change it: a resultatansvarig sees every utlägg touching their result
  // unit, and offering them "Redigera" opened the whole wizard on someone
  // else's claim only for PATCH /api/expenses/[id] to refuse the save. The
  // server rule is `canEditExpense` (submitter or admin) — this is its half.
  const canEdit = isEditable(expense.status) && mayAct;
  // Admin may delete any utlägg; a user may delete their own unless it's
  // attested or further.
  const canDelete = admin || (isOwner && !isSigned(expense.status));
  const hasPrimaryAction = canApprove || canBook || canExport || canSubmit || canReturn;

  return {
    canSubmit,
    submitBlocker: submittable && mayAct ? blocker : null,
    canApprove,
    canWithdrawAttest,
    canRequestChanges,
    canReturn,
    canBook,
    canExport,
    canUnexport: mayUnexport,
    // A booked voucher can still be amended until it's exported to Fortnox.
    canEditVerification: bookkeeper && expense.status === "BOOKED",
    canEdit,
    canMatch: expense.paymentType === "CARD" && submittable && mayAct,
    canDelete,
    hasPrimaryAction,
    hasAnyAction:
      hasPrimaryAction ||
      canWithdrawAttest ||
      canRequestChanges ||
      canEdit ||
      canDelete ||
      mayUnexport,
  };
}
