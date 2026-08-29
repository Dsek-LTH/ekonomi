// Which actions the detail page offers for one expense, to one viewer.
//
// Pure and React-free: role capabilities (permissions.ts) and status rules
// (status.ts) go in, a flat set of booleans comes out.
//
// It lives in lib/domain, and is called on the *server* — the detail page
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
  canUnexport,
  isAdmin,
} from "@/lib/domain/permissions";
import {
  isAttestWithdrawable,
  isEditable,
  isSigned,
  isSubmittable,
  submitBlocker,
  type SubmitBlocker,
} from "./status";
import type { Capability, Expense, Role } from "./types";

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
  viewer: { id: string; roles: readonly Role[]; capabilities: readonly Capability[] },
): ExpenseCapabilities {
  const bookkeeper = canBookkeep(viewer.capabilities);
  const admin = isAdmin(viewer.capabilities);
  const isOwner = expense.submitterId === viewer.id;
  const submittable = isSubmittable(expense.status);
  const mayAct = isOwner || admin;
  const blocker = submitBlocker({
    ...expense,
    hasReceipt: Boolean(expense.receiptId),
    // A milersättning is asked for its journey rather than a receipt, and
    // without this it was asked for neither: `mileageBlocker` came through
    // undefined, the check passed, and the detail page offered "Skicka in" on
    // a claim the transition route would refuse.
    //
    // Read off the claim rather than re-derived from the rate table, which is
    // not on this side of the wire: `km` is null until the two readings make a
    // journey, and `orePerKm` is null until one was valued — which is exactly
    // what claimBlocker refuses on. The wording is the form's business; all
    // that is needed here is whether something is wrong.
    mileageBlocker:
      expense.paymentType === "MILEAGE" &&
      (expense.mileage?.km == null || expense.mileage?.orePerKm == null)
        ? "incomplete"
        : null,
  });

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
  // Exporting is a real Fortnox call made under the bookkeeper's own login, so
  // it takes the narrower role set — the one that *has* such a login. The chair
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
