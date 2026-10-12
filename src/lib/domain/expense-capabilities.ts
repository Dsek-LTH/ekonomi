// Which actions the detail page offers for one expense, to one viewer.
//
// Pure and React-free: role capabilities (permissions.ts) and status rules
// (status.ts) go in, a flat set of booleans comes out.
//
// It lives in lib/domain, and is called on the *server*. The detail page
// derives it once and hands the answer down. That is not where it started: it
// was a client module, deriving the same rules the API enforces, from a second
// copy of them written by hand. Each of those copies was a place the two could
// drift, and one had: `canExport` offered the button to anyone with bookkeeping
// access, which includes the ordförande, who has no Fortnox login and could
// never complete it (see `canLogInToFortnox`).
//
// One derivation, on the side that decides, in a module the tests can reach.
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
  /** Why submitting isn't possible yet, shown only to someone who could
   *  submit, as a key under `expenses.submitBlocker`. */
  submitBlocker: SubmitBlocker | null;
  canApprove: boolean;
  /** Viewer has signed at least one allocation and can still take it back. */
  canWithdrawAttest: boolean;
  /**
   * The submitter may take the whole utlägg back out of the queue, to a draft.
   *
   * Their own act, not the attester's `canWithdrawAttest`: what comes back is
   * the claim itself, so it can be corrected: a purchase filed as an eget
   * utlägg that turns out to have gone on the section card, most often, which
   * is a change no attester can make for them.
   */
  canRecall: boolean;
  canRequestChanges: boolean;
  canReturn: boolean;
  canBook: boolean;
  canExport: boolean;
  /** May take an exported utlägg back to bokförd, our record only, the Fortnox
   *  voucher stays where it is. */
  canUnexport: boolean;
  canEditVerification: boolean;
  canEdit: boolean;
  /**
   * May grant this late utlägg a dispens from the filing deadline.
   *
   * Offered only where there is something to grant: a claim that is actually
   * late, still in the submitter's hands, and without a dispens already. The
   * deadline stops a late claim from entering the attest queue, so once it has
   * left those statuses a dispens would be permitting something that already
   * happened, which is why the status is part of the question and not just the
   * capability. See canWaiveFilingDeadline.
   */
  canWaiveDeadline: boolean;
  /** May take that dispens back, while the utlägg is still unsent. */
  canRevokeDeadlineWaiver: boolean;
  canMatch: boolean;
  canDelete: boolean;
  /**
   * May remind whoever this utlägg is waiting on. Only while it is waiting on
   * somebody other than the viewer: a draft of their own is theirs to send.
   * Who exactly it reaches is the server's to work out; see
   * lib/server/reminders.ts.
   */
  canRemind: boolean;
  /** Whether any call-to-action is offered, which demotes "Redigera" to secondary. */
  hasPrimaryAction: boolean;
  /** Whether the panel offers anything at all. Otherwise it says so. */
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
    // A dispens is the one thing that lets a late claim through, and it is a
    // fact about the row rather than about this viewer: the submitter sees the
    // block lift at the same moment everybody else does.
    deadlineWaived: Boolean(expense.deadlineWaiver),
    // A milersättning is asked for its journey rather than a receipt, and
    // without this it was asked for neither: `mileageBlocker` came through
    // undefined, the check passed, and the detail page offered "Skicka in" on
    // a claim the transition route would refuse.
    //
    // Read off the claim rather than re-derived from the rate table, which is
    // not on this side of the wire: `km` is null until the two readings make a
    // journey, and `orePerKm` is null until one was valued, which is exactly
    // what claimBlocker refuses on. The route is checked here too, for the same
    // reason and against the same failure: it is the half of the underlag that
    // says the driving was the section's errand, the transition route refuses a
    // claim missing it, and a page that offered "Skicka in" anyway would be
    // promising something the server will not do.
    //
    // The wording is the form's business; all that is needed here is whether
    // something is wrong.
    mileageBlocker:
      expense.paymentType === "MILEAGE" &&
      (expense.mileage?.km == null ||
        expense.mileage.orePerKm == null ||
        namedStops(expense.mileage.stops).length < 2)
        ? "incomplete"
        : null,
  });

  const canSubmit = submittable && mayAct && !blocker;
  // The dispens, and the two halves of when it is on offer. `submittable` is
  // what "before it goes for attest" means here: the same set of statuses the
  // transition route holds the grant to.
  const mayWaive =
    canWaiveFilingDeadline(viewer.capabilities) &&
    submittable &&
    isLateReimbursement(expense.purchaseDate, expense.paymentType);
  const waived = Boolean(expense.deadlineWaiver);
  const canApprove =
    expense.status === "PENDING_APPROVAL" &&
    expense.allocations.some((a) => a.canAttest && !a.approvedById);
  // Mirrors the server rule: your own signature, on a row you may still
  // attest, on an utlägg that hasn't been booked yet.
  const canWithdrawAttest =
    isAttestWithdrawable(expense.status) &&
    expense.allocations.some((a) => a.canAttest && a.approvedById === viewer.id);
  // Whoever may send it may take it back. An admin can do either on somebody's
  // behalf, exactly as they can submit for them.
  const canRecall = isRecallable(expense.status) && mayAct;
  const canReturn = !!expense.canReturn && expense.status === "APPROVED";
  const canBook = bookkeeper && expense.status === "APPROVED";
  // Exporting is a real Fortnox call made under the bookkeeper's own login, so
  // it takes the narrower role set, the one that *has* such a login. The chair
  // counts as bookkeeping in this app and has no Fortnox account, and was being
  // offered a button whose first step would have asked them to sign in to
  // something they cannot sign in to.
  const canExport = canLogInToFortnox(viewer.capabilities) && expense.status === "BOOKED";
  const mayUnexport = canUnexport(viewer.capabilities) && expense.status === "EXPORTED";
  const canRequestChanges =
    expense.status === "PENDING_APPROVAL" && expense.allocations.some((a) => a.canAttest);
  // Status *and* standing. Being allowed to see an utlägg is not being allowed
  // to change it: a resultatansvarig sees every utlägg touching their result
  // unit, and offering them "Redigera" opened the whole wizard on someone
  // else's claim only for PATCH /api/expenses/[id] to refuse the save. The
  // server rule is `canEditExpense` (submitter or admin). This is its half.
  const canEdit = isEditable(expense.status) && mayAct;
  // Admin may delete any utlägg; a user may delete their own unless it's
  // attested or further.
  const canDelete = admin || (isOwner && !isSigned(expense.status));
  const canWaiveDeadline = mayWaive && !waived;
  const canRevokeDeadlineWaiver = mayWaive && waived;
  const canRemind =
    canSendReminders(viewer.capabilities) && canRemindAboutExpense(expense, viewer.id);
  // Leading, when it is on offer at all. A late utlägg with nobody able to move
  // it is the one thing on this page anybody is waiting for, and the person who
  // can move it is not the person whose claim it is.
  const hasPrimaryAction =
    canApprove || canBook || canExport || canSubmit || canReturn || canWaiveDeadline;

  return {
    canSubmit,
    submitBlocker: submittable && mayAct ? blocker : null,
    canApprove,
    canWithdrawAttest,
    canRecall,
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
