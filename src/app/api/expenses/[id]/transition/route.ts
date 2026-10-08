// Drive an utlägg through its lifecycle. One endpoint, validated state machine.
// Booking is separate (/book) because it creates a verification.
// [id] param is the expense id.
//
// This is also where an utlägg gets its human reference: submitting is the act
// that turns a draft into a claim, so it is the first moment the section has
// anything worth numbering. See lib/server/expense-reference.ts.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { claimReference, withReferenceRetry } from "@/lib/server/expense-reference";
import {
  canAttestAllocation,
  canReturnApproved,
  canUnexport,
  canWaiveFilingDeadline,
  isAdmin,
} from "@/lib/domain/permissions";
import { resultUnitNameForCode, getPrefixes, ownedResultUnits } from "@/lib/server/result-units";
import { fail, gate } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { TransitionExpense } from "@/lib/api/schemas/expense";
import { denyExpenseView } from "@/lib/api/expense-access";
import {
  REIMBURSEMENT_DEADLINE_DAYS,
  SUBMITTABLE_STATUSES,
  isAttestWithdrawable,
  isRecallable,
  isSigned,
  isLateReimbursement,
  isOutOfPocket,
} from "@/lib/domain/status";
import { claimBlocker } from "@/lib/mileage/claim";
import { getMileageRates } from "@/lib/mileage/store";
import { cancelsOut } from "@/lib/domain/matching";
import { isFutureDate } from "@/lib/domain/date";
import type { ExpenseStatus } from "@/lib/generated/prisma/client";

// Note: export (BOOKED → EXPORTED) is NOT here. It's a real Fortnox API call,
// handled by app/api/expenses/[id]/export/route.ts.
type SimpleAction = "submit" | "request_changes";

// ── Acting on the state you actually checked ──────────────────────
//
// Every branch below reads the utlägg once, decides against what it read, and
// then writes. Between those two moments somebody else can act on the same
// utlägg, whether two attestants clicking at once or one person's second tab, and
// the write would land on a row that no longer looks like the one the decision
// was made about. Nothing failed; the numbers simply stopped meaning what they
// said. In the approve path it was worse than a lost update: the rows to sign
// were chosen by `!a.approvedById` outside the transaction and then written by
// id alone, so the second writer replaced the first one's signature with their
// own name. An attest trail that can silently reattribute a signature is not
// one.
//
// So no write here is addressed by id alone. Each one restates the condition it
// was decided under, the status it expects and the approval slot it expects to
// be empty, and `applied` insists that it actually matched something. A write
// that matched nothing means the world moved underneath us, which is a 409 and
// a reload, not a silent success.
class StaleWrite extends Error {
  constructor(readonly code = "expense.changedMeanwhile") {
    super(code);
  }
}

/** Assert a conditional write matched the row it was aimed at. */
function applied({ count }: { count: number }, code?: string): void {
  if (count === 0) throw new StaleWrite(code);
}

/** Run a transition body, turning a lost race into a 409 rather than a 500. */
async function commit<T>(body: () => Promise<T>): Promise<T | NextResponse> {
  try {
    return await body();
  } catch (err) {
    if (err instanceof StaleWrite) return fail(409, err.code);
    throw err;
  }
}

const SIMPLE_TRANSITIONS: Record<
  SimpleAction,
  { from: ExpenseStatus[]; to: ExpenseStatus; event: string; requireComment?: boolean }
> = {
  submit: {
    from: SUBMITTABLE_STATUSES,
    to: "PENDING_APPROVAL",
    event: "SUBMITTED",
  },
  request_changes: {
    from: ["PENDING_APPROVAL"],
    to: "CHANGES_REQUESTED",
    event: "CHANGES_REQUESTED",
    requireComment: true,
  },
};

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const g = await gate();
  if (!g.ok) return g.res;
  const actor = g.actor;
  const actorId = actor.id;

  const parsed = await parseBody(req, TransitionExpense);
  if (!parsed.ok) return parsed.res;
  const { action, comment } = parsed.data;

  const expense = await prisma.expense.findUnique({
    where: { id },
    include: {
      allocations: { include: { costCenter: true } },
      matchedTransaction: { select: { amount: true } },
      // Only whether one exists, since submitting asks nothing else of it.
      receipts: { select: { id: true }, take: 1 },
      submitter: {
        select: { roles: true, bankClearingNumber: true, bankAccountNumber: true },
      },
    },
  });
  if (!expense) return fail(404, "expense.notFound");

  // An utlägg outside the caller's scope is not found, the same as everywhere
  // else. Every branch below has its own authority check, but none of them
  // should be reached for an utlägg whose existence isn't the caller's business.
  const hidden = await denyExpenseView(g.actor, expense);
  if (hidden) return hidden;

  // The acting user's result unit ownerships drive attest authority, alongside
  // the roles the gate already resolved.
  const [{ names: actorOwned }, prefixes] = await Promise.all([
    ownedResultUnits(actor),
    getPrefixes(),
  ]);
  const actorIsSubmitter = actorId === expense.submitterId;

  // Whether the actor may attest a given allocation (also gates reject / return).
  // The allocation's result unit comes from its cost-centre code prefix.
  const mayAttest = (a: (typeof expense.allocations)[number]) =>
    canAttestAllocation({
      actorCapabilities: actor.capabilities,
      actorRoles: actor.roles,
      actorIsSubmitter,
      actorOwnedResultUnits: actorOwned,
      allocationResultUnit: resultUnitNameForCode(a.costCenter.code, prefixes),
    });

  // ── Approve: partial per-cost-centre approval ─────────────────────────────
  if (action === "approve") {
    if (expense.status !== "PENDING_APPROVAL") {
      return fail(409, "expense.cannotApproveFromStatus", {
        values: { status: { key: `common.status.${expense.status}` } },
      });
    }

    // Allocations the acting user is authorised to attest and that aren't
    // approved yet. Authority comes from the role/result unit policy.
    const mine = expense.allocations.filter((a) => !a.approvedById && mayAttest(a));
    if (mine.length === 0) {
      return fail(403, "expense.nothingToApprove");
    }

    const now = new Date();
    const result = await commit(() =>
      prisma.$transaction(async (tx) => {
        // Stamp each of the actor's pending allocations as approved. Still
        // pending is part of the condition, not just part of how they were
        // picked. Without it this overwrote a signature somebody else had put
        // there in the meantime, and the timeline showed ours.
        applied(
          await tx.expenseCostAllocation.updateMany({
            where: { id: { in: mine.map((a) => a.id) }, approvedById: null },
            data: { approvedById: actorId, approvedAt: now },
          }),
          "expense.alreadyAttested",
        );

        // Reload to check if ALL allocations are now approved.
        const remaining = await tx.expenseCostAllocation.count({
          where: { expenseId: expense.id, approvedById: null },
        });

        await tx.expenseEvent.create({
          data: { expenseId: expense.id, type: "COST_CENTER_APPROVED", actorId },
        });
        if (remaining === 0) {
          // The last signature. The utlägg has to still be waiting for one.
          // If it was sent back for changes while we were signing, this is not
          // an utlägg to mark attested.
          applied(
            await tx.expense.updateMany({
              where: { id: expense.id, status: "PENDING_APPROVAL" },
              data: { status: "APPROVED" },
            }),
          );
          return "APPROVED" as const;
        }
        return "PENDING_APPROVAL" as const;
      }),
    );
    if (result instanceof NextResponse) return result;
    return NextResponse.json({ id, status: result });
  }

  // ── Withdraw your own attest ──────────────────────────────────────────────
  // An approver (in practice a resultatansvarig) can regret: their own
  // allocation approvals are cleared, and if that was the last one holding the
  // expense at APPROVED it drops back to PENDING_APPROVAL. Only their own
  // signatures are touched, and other cost centres keep theirs.
  if (action === "withdraw_attest") {
    if (!isAttestWithdrawable(expense.status)) {
      return expense.status === "BOOKED" || expense.status === "EXPORTED"
        ? fail(409, "expense.withdrawAfterBooked")
        : fail(409, "expense.nothingToWithdraw", {
            values: { status: { key: `common.status.${expense.status}` } },
          });
    }

    // Rows this user signed and may still attest. Losing the authority (e.g.
    // handing over the resultatenhet) also ends the right to undo the signature.
    const mine = expense.allocations.filter((a) => a.approvedById === actorId && mayAttest(a));
    if (mine.length === 0) {
      return fail(403, "expense.noApprovalToWithdraw");
    }

    const withdrawn = await commit(() =>
      prisma.$transaction(async (tx) => {
        // Yours to take back, and still yours at the moment of writing.
        applied(
          await tx.expenseCostAllocation.updateMany({
            where: { id: { in: mine.map((a) => a.id) }, approvedById: actorId },
            data: { approvedById: null, approvedAt: null },
          }),
          "expense.noApprovalToWithdraw",
        );
        // The utlägg is only fully attested while every allocation is signed.
        if (expense.status === "APPROVED") {
          applied(
            await tx.expense.updateMany({
              where: { id: expense.id, status: "APPROVED" },
              data: { status: "PENDING_APPROVAL" },
            }),
          );
        }
        await tx.expenseEvent.create({
          data: {
            expenseId: expense.id,
            type: "ATTEST_WITHDRAWN",
            actorId,
            comment: comment || null,
          },
        });
      }),
    );
    if (withdrawn instanceof NextResponse) return withdrawn;

    return NextResponse.json({ id, status: "PENDING_APPROVAL" });
  }

  // ── Take your own submission back ─────────────────────────────────────────
  //
  // The submitter's counterpart to the attester's `withdraw_attest` above, and a
  // different act by a different person: that one takes back a signature, this
  // takes back the whole claim. It exists for the correction no attester can
  // make on the submitter's behalf: a purchase filed as an eget utlägg that
  // turns out to have gone on the section card. Changing that means changing the
  // payment type, and a card purchase needs a bank row matched to it, which may
  // not have landed yet. So it comes back as a draft: theirs again, editable,
  // and under no obligation to be finished today.
  if (action === "recall") {
    if (!actorIsSubmitter && !isAdmin(actor.capabilities)) {
      return fail(403, "expense.noRecallAccess");
    }
    if (!isRecallable(expense.status)) {
      // Once it is actually attested it is not the submitter's to pull back:
      // somebody agreed to it, and undoing that is bookkeeping's call. See
      // `return_approved` below.
      return isSigned(expense.status)
        ? fail(409, "expense.recallAfterApproved")
        : fail(409, "expense.nothingToRecall", {
            values: { status: { key: `common.status.${expense.status}` } },
          });
    }

    const recalled = await commit(() =>
      prisma.$transaction(async (tx) => {
        // Every signature on it, not only the ones the actor could see or give.
        // An attest is a statement about the claim as it stood ("this 420 kr
        // of Sexmästeriets money was spent privately and should be paid back")
        // and this action exists precisely to change what it stood for. Carrying
        // them over would leave a row signed for a claim that no longer says
        // what was signed.
        await tx.expenseCostAllocation.updateMany({
          where: { expenseId: expense.id, approvedById: { not: null } },
          data: { approvedById: null, approvedAt: null },
        });
        // Conditional on the status it was read at: two people pressing at once,
        // or an attester approving the last row while this was in flight, must
        // not have this quietly win.
        applied(
          await tx.expense.updateMany({
            where: { id: expense.id, status: "PENDING_APPROVAL" },
            data: { status: "DRAFT" },
          }),
        );
        // The reference is deliberately kept. It was handed out when the utlägg
        // was first sent (see `claimReference`, which only draws a number for an
        // utlägg that has none), so the same claim keeps the same number across
        // a correction rather than burning a second one out of the year's
        // sequence, and the timeline underneath it stays one story.
        await tx.expenseEvent.create({
          data: {
            expenseId: expense.id,
            type: "RECALLED",
            actorId,
            comment: comment || null,
          },
        });
      }),
    );
    if (recalled instanceof NextResponse) return recalled;

    return NextResponse.json({ id, status: "DRAFT" });
  }

  // ── Return a wrongly-approved expense for changes ─────────────────────────
  // Bookkeeping roles (skattmästare/ordförande/vice/skattförman) can pull an
  // already-attested expense back to CHANGES_REQUESTED. Clears all allocation
  // approvals so it re-enters the attest flow.
  if (action === "return_approved") {
    if (!canReturnApproved(actor.capabilities)) {
      return fail(403, "expense.noReopenAccess");
    }
    if (expense.status !== "APPROVED") {
      return expense.status === "BOOKED" || expense.status === "EXPORTED"
        ? fail(409, "expense.reopenAfterBooked")
        : fail(409, "expense.reopenOnlyApproved", {
            values: { status: { key: `common.status.${expense.status}` } },
          });
    }
    if (!comment) {
      return fail(422, "expense.commentRequiredReopen");
    }
    const reopened = await commit(() =>
      prisma.$transaction(async (tx) => {
        // Still attested when the write lands, or this is not ours to reopen.
        applied(
          await tx.expense.updateMany({
            where: { id: expense.id, status: "APPROVED" },
            data: { status: "CHANGES_REQUESTED" },
          }),
        );
        await tx.expenseCostAllocation.updateMany({
          where: { expenseId: expense.id },
          data: { approvedById: null, approvedAt: null },
        });
        await tx.expenseEvent.create({
          data: { expenseId: expense.id, type: "CHANGES_REQUESTED", actorId, comment },
        });
      }),
    );
    if (reopened instanceof NextResponse) return reopened;
    return NextResponse.json({ id, status: "CHANGES_REQUESTED" });
  }

  // Undo an export: EXPORTED → BOOKED, clearing the Fortnox voucher reference
  // so the utlägg can be amended and exported again.
  //
  // This only unwinds OUR record. The voucher already exists in Fortnox and is
  // NOT touched. Deleting or reversing it there is a manual job, and skipping
  // it means the next export creates a second voucher for the same utlägg.
  // Hence the required reason and the narrow role gate.
  if (action === "unexport") {
    if (!canUnexport(actor.capabilities)) {
      return fail(403, "expense.noUnexportAccess");
    }
    if (expense.status !== "EXPORTED") {
      return fail(409, "expense.unexportOnlyExported", {
        values: { status: { key: `common.status.${expense.status}` } },
      });
    }
    if (!comment) {
      return fail(422, "expense.commentRequiredUnexport");
    }
    const reverted = await commit(() =>
      prisma.$transaction(async (tx) => {
        // Still exported when the write lands. Two people undoing the same
        // export would otherwise both succeed and both log a reason.
        applied(
          await tx.expense.updateMany({
            where: { id: expense.id, status: "EXPORTED" },
            data: {
              status: "BOOKED",
              // The stored utläggsräkning goes with the export it was written
              // for. The whole reason to unexport is to amend the utlägg, and
              // the cover names the attestations and amounts being amended, so
              // keeping it would have the next export upload a page describing
              // the version before the correction. Cleared, the next export
              // draws a fresh one (lib/expense/document.ts).
              //
              // The object itself is left for the sweeper rather than deleted
              // here: this runs inside the transaction, and a storage call that
              // fails after the status has flipped would leave the two
              // disagreeing about a file nobody can reach anyway.
              documentKey: null,
              documentFilename: null,
            },
          }),
        );
        await tx.verification.updateMany({
          where: { expenseId: expense.id },
          data: {
            fortnoxSeries: null,
            fortnoxNumber: null,
            fortnoxYear: null,
            exportedAt: null,
          },
        });
        await tx.expenseEvent.create({
          data: { expenseId: expense.id, type: "EXPORT_REVERTED", actorId, comment },
        });
      }),
    );
    if (reverted instanceof NextResponse) return reverted;
    return NextResponse.json({ id, status: "BOOKED" });
  }

  // ── Dispens från redovisningsfristen ──────────────────────────────────────
  //
  // An eget utlägg handed in more than REIMBURSEMENT_DEADLINE_DAYS after the
  // purchase is not reimbursed. This is the section deciding, for this one
  // claim, to take it anyway.
  //
  // Three conditions, and each of them is the rule rather than a convenience:
  //
  //   the capability   which is the skattmästare's, and only theirs by default
  //   a status that has not gone for attest yet, because the deadline stops a
  //                    late claim from *entering* the queue, so a dispens given
  //                    afterwards would be permitting what already happened
  //   an actually late claim, so that a dispens on the record always means
  //                    something. Granting one on a claim in good time would
  //                    leave a reason nobody can read back.
  //
  // And a reason, required, because "who allowed this and why" is the whole of
  // what the record is for. The utläggsräkning prints it.
  if (action === "waive_deadline" || action === "revoke_deadline_waiver") {
    if (!canWaiveFilingDeadline(actor.capabilities)) {
      return fail(403, "expense.noWaiveAccess");
    }
    if (!SUBMITTABLE_STATUSES.includes(expense.status)) {
      return fail(409, "expense.waiveOnlyBeforeAttest", {
        values: { status: { key: `common.status.${expense.status}` } },
      });
    }

    if (action === "revoke_deadline_waiver") {
      if (!expense.deadlineWaivedAt) return fail(422, "expense.noWaiverToRevoke");
      const revoked = await commit(() =>
        prisma.$transaction(async (tx) => {
          // Still waived, and still unsent, when the write lands.
          applied(
            await tx.expense.updateMany({
              where: {
                id: expense.id,
                status: { in: SUBMITTABLE_STATUSES },
                deadlineWaivedAt: { not: null },
              },
              data: {
                deadlineWaivedById: null,
                deadlineWaivedAt: null,
                deadlineWaiverReason: null,
              },
            }),
          );
          await tx.expenseEvent.create({
            data: {
              expenseId: expense.id,
              type: "DEADLINE_WAIVER_REVOKED",
              actorId,
              // Optional here, unlike on the grant. Taking a dispens back
              // returns the utlägg to the rule everybody already knows, and
              // there is nothing to explain that the rule does not.
              comment: comment || null,
            },
          });
        }),
      );
      if (revoked instanceof NextResponse) return revoked;
      return NextResponse.json({ id, deadlineWaived: false });
    }

    // The claim has to be one the deadline actually stops. A draft with no date
    // yet is not late; it is unfinished, and `isLateReimbursement` says so by
    // wanting a whole date.
    const purchaseDate = expense.purchaseDate?.toISOString().slice(0, 10) ?? "";
    if (!isLateReimbursement(purchaseDate, expense.paymentType)) {
      return fail(422, "expense.nothingToWaive", {
        values: { days: REIMBURSEMENT_DEADLINE_DAYS },
      });
    }
    if (!comment) return fail(422, "expense.commentRequiredWaive");
    if (expense.deadlineWaivedAt) return fail(409, "expense.alreadyWaived");

    const waived = await commit(() =>
      prisma.$transaction(async (tx) => {
        // Not yet waived, and not yet sent, when the write lands: two
        // skattmästare granting at once would otherwise both log a reason and
        // the second would overwrite the first.
        applied(
          await tx.expense.updateMany({
            where: {
              id: expense.id,
              status: { in: SUBMITTABLE_STATUSES },
              deadlineWaivedAt: null,
            },
            data: {
              deadlineWaivedById: actorId,
              deadlineWaivedAt: new Date(),
              deadlineWaiverReason: comment,
            },
          }),
        );
        await tx.expenseEvent.create({
          data: {
            expenseId: expense.id,
            type: "DEADLINE_WAIVED",
            actorId,
            comment,
          },
        });
      }),
    );
    if (waived instanceof NextResponse) return waived;
    return NextResponse.json({ id, deadlineWaived: true });
  }

  // ── Simple state-machine transitions ──────────────────────────────────────
  // Whatever is left is one of the two simple transitions. The schema's enum
  // is what says so, and the check that used to answer 400 for an unknown
  // action is gone with it.
  const rule = SIMPLE_TRANSITIONS[action as SimpleAction];
  if (!rule.from.includes(expense.status)) {
    return fail(409, "expense.actionNotFromStatus", {
      values: { status: { key: `common.status.${expense.status}` } },
    });
  }
  if (action === "submit") {
    // Sending an utlägg for attest is the submitter's act. It is their claim,
    // and it lands in someone else's queue signed with their name. An admin may
    // do it on their behalf; nobody else may, however complete the utlägg
    // happens to be. Mirrors `mayAct` in lib/domain/expense-capabilities.ts,
    // which is what decides whether the button is offered.
    if (!actorIsSubmitter && !isAdmin(actor.capabilities)) {
      return fail(403, "expense.noSubmitAccess");
    }
    // Complete information is required before an expense can go for attest.
    if (!expense.title.trim() || expense.purchaseDate === null || expense.grossAmount === null) {
      return fail(422, "expense.incomplete");
    }
    // A day that hasn't come yet is not a purchase. PATCH refuses to store one,
    // so this catches the rows that predate that rule. Sending one on for
    // attest is exactly where it would stop being the submitter's to fix.
    // Stored as @db.Date, i.e. midnight UTC, so the ISO day is the day meant.
    if (isFutureDate(expense.purchaseDate.toISOString().slice(0, 10))) {
      return fail(422, "expense.futureDate");
    }
    // The filing deadline, and the place it really bites: an eget utlägg handed
    // in more than 60 days after the purchase is not reimbursed, so it never
    // enters anyone's attest queue. A draft that aged past the deadline is
    // stopped here even though PATCH kept letting it be saved.
    //
    // Unless it has been given a dispens, which is exactly the moment one is
    // for: the skattmästare has already decided, on the record and with a
    // reason, that this late claim may be filed. See the branch below and the
    // dispens columns on Expense.
    if (
      !expense.deadlineWaivedAt &&
      isLateReimbursement(
        expense.purchaseDate.toISOString().slice(0, 10),
        expense.paymentType,
      )
    ) {
      return fail(422, "expense.reimbursementTooLate", {
        values: { days: REIMBURSEMENT_DEADLINE_DAYS },
      });
    }
    // And the underlag it all rests on. The wizard won't let you past the
    // details without one, but the wizard isn't the only way in here. This is
    // the rule, and that is a convenience on top of it.
    //
    // A milersättning has no underlag to upload: nobody photographs driving
    // their own car, and the journey it rests on is typeset onto the
    // utläggsräkning instead. So the journey *is* the underlag, and what is
    // required of it is what Skatteverket asks of one: where it went, and how
    // far, at a rate the day can be priced at. The readings give the distance,
    // the stops give the errand, and neither on its own is evidence of a
    // tjänsteresa. The same answer the form was showing while it was being
    // filled in, asked again here where it is actually enforced.
    // See lib/mileage/claim.ts.
    if (expense.paymentType === "MILEAGE") {
      const blocker = claimBlocker(
        {
          // Whole and not in the future by the two checks above, so the date
          // this is valued against is the one the claim will be paid on.
          date: expense.purchaseDate.toISOString().slice(0, 10),
          odometerStart:
            expense.odometerStart == null ? null : Number(expense.odometerStart),
          odometerEnd: expense.odometerEnd == null ? null : Number(expense.odometerEnd),
          stops: expense.journeyStops,
        },
        await getMileageRates(),
      );
      if (blocker) return fail(422, `mileage.${blocker}`);
    } else if (expense.receipts.length === 0) {
      return fail(422, "expense.receiptRequired");
    }
    if (expense.paymentType === "CARD" && !expense.matchedTransactionId) {
      return fail(422, "expense.matchRequired");
    }
    // The amount can be edited after the match was made, so the pair is checked
    // again here rather than trusted from when it was set.
    if (
      expense.matchedTransaction &&
      !cancelsOut(expense.matchedTransaction.amount, expense.grossAmount ?? 0)
    ) {
      return fail(422, "expense.matchStale");
    }
    // Out-of-pocket claims need the submitter's payout account to pay them
    // back, a milersättning as much as a receipt they paid, since both are
    // the section owing a member money rather than money it has already spent.
    if (
      isOutOfPocket(expense.paymentType) &&
      (!expense.submitter.bankClearingNumber || !expense.submitter.bankAccountNumber)
    ) {
      return fail(422, "expense.payoutRequired");
    }
    if (expense.allocations.length === 0) {
      return fail(422, "expense.costCenterRequired");
    }
    const allocSum = expense.allocations.reduce((s, a) => s + a.amount, 0);
    if (allocSum !== expense.grossAmount) {
      return fail(422, "expense.allocationsUnbalanced");
    }
  }
  // Requesting changes is an attest-side action: only someone authorised to
  // attest at least one of the expense's allocations may send it back.
  if (action === "request_changes" && !expense.allocations.some(mayAttest)) {
    return fail(403, "expense.noRequestChangesAccess");
  }
  if (rule.requireComment && !comment) {
    return fail(422, "expense.commentRequired");
  }

  const written = await commit(() =>
    withReferenceRetry(() =>
      prisma.$transaction(async (tx) => {
        // Clear allocation approvals when going back to editable state.
        if (rule.to === "CHANGES_REQUESTED") {
          await tx.expenseCostAllocation.updateMany({
            where: { expenseId: expense.id },
            data: { approvedById: null, approvedAt: null },
          });
        }
        // The number, on the way in. Only on submit, and only once: an utlägg sent
        // back for changes and re-submitted keeps the number it was already known
        // by. To everyone who has seen it, it is the same utlägg.
        const reference =
          action === "submit" && expense.reference === null
            ? await claimReference(tx)
            : undefined;
        // The status this transition was permitted from has to still be the
        // status it is in. Two submits of the same draft would both have passed
        // the check above and both written, and the second would have found a
        // reference already claimed by the first.
        applied(
          await tx.expense.updateMany({
            where: { id: expense.id, status: { in: rule.from } },
            data: { status: rule.to, ...(reference ? { reference } : {}) },
          }),
        );
        await tx.expenseEvent.create({
          data: {
            expenseId: expense.id,
            type: rule.event as Parameters<typeof tx.expenseEvent.create>[0]["data"]["type"],
            actorId,
            comment: comment || null,
          },
        });
        return reference ?? expense.reference;
      }),
    ),
  );
  if (written instanceof NextResponse) return written;

  return NextResponse.json({ id, reference: written, status: rule.to });
}
