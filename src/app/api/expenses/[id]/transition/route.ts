// Drive an utlägg through its lifecycle: one endpoint, validated state machine. Booking is /book, export is /export.
// Submitting is where the human reference is assigned (lib/server/expense-reference.ts).
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
import { applied, commit } from "@/lib/api/stale-write";
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
import { attestersOf, deliverSoon, holdersOf, notify } from "@/lib/server/notify";
import { expenseNotice } from "@/lib/email/content";
import { isFutureDate, isoDay } from "@/lib/domain/date";
import type { ExpenseStatus } from "@/lib/generated/prisma/client";

type SimpleAction = "submit" | "request_changes";

// Every write is conditional on the state it was decided against (lib/api/stale-write.ts).

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

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await gate();
  if (!g.ok) return g.res;
  const actor = g.actor;
  const actorId = actor.id;

  const parsed = await parseBody(req, TransitionExpense);
  if (!parsed.ok) return parsed.res;
  const { action, comment, allocationIds } = parsed.data;

  const expense = await prisma.expense.findUnique({
    where: { id },
    include: {
      allocations: { include: { costCenter: true } },
      matchedTransaction: { select: { amount: true } },
      receipts: { select: { id: true }, take: 1 },
      submitter: {
        select: {
          name: true,
          roles: true,
          bankClearingNumber: true,
          bankAccountNumber: true,
        },
      },
    },
  });
  if (!expense) return fail(404, "expense.notFound");

  // An utlägg outside the caller's scope is not found.
  const hidden = await denyExpenseView(g.actor, expense);
  if (hidden) return hidden;

  const [{ names: actorOwned }, prefixes] = await Promise.all([
    ownedResultUnits(actor),
    getPrefixes(),
  ]);
  const actorIsSubmitter = actorId === expense.submitterId;

  // The allocation's result unit comes from its cost-centre code prefix.
  const mayAttest = (a: (typeof expense.allocations)[number]) =>
    canAttestAllocation({
      actorCapabilities: actor.capabilities,
      actorRoles: actor.roles,
      actorIsSubmitter,
      actorOwnedResultUnits: actorOwned,
      allocationResultUnit: resultUnitNameForCode(a.costCenter.code, prefixes),
    });

  const about = (
    key: Parameters<typeof expenseNotice>[0],
    values: Record<string, string | number> = {},
    reference = expense.reference,
  ) =>
    expenseNotice(
      key,
      { ...expense, reference },
      { actor: actor.name, submitter: expense.submitter.name, ...values },
      { author: actor.name, text: comment || null },
    );
  // Whoever is asked to attest it: the same people its SUBMITTED mail went to.
  const attesters = () =>
    attestersOf(
      expense.allocations.map((a) => ({ costCenterCode: a.costCenter.code })),
      expense.submitterId,
    );

  // ── Approve: partial per-cost-centre approval ─────────────────────────────
  if (action === "approve") {
    if (expense.status !== "PENDING_APPROVAL") {
      return fail(409, "expense.cannotApproveFromStatus", {
        values: { status: { key: `common.status.${expense.status}` } },
      });
    }

    const attestable = expense.allocations.filter((a) => !a.approvedById && mayAttest(a));
    // Narrowed to the picked rows, each of which must be signable now.
    let mine = attestable;
    if (allocationIds) {
      const picked = new Set(allocationIds);
      mine = attestable.filter((a) => picked.has(a.id));
      if (mine.length < picked.size) {
        const signedMeanwhile = expense.allocations.some((a) => picked.has(a.id) && a.approvedById);
        return signedMeanwhile
          ? fail(409, "expense.alreadyAttested")
          : fail(403, "expense.nothingToApprove");
      }
    }
    if (mine.length === 0) {
      return fail(403, "expense.nothingToApprove");
    }

    const now = new Date();
    const bookkeepers = await holdersOf("BOOKKEEPING");
    const result = await commit(() =>
      prisma.$transaction(async (tx) => {
        // Still pending is part of the write's condition, so it cannot overwrite a signature put there meanwhile.
        applied(
          await tx.expenseCostAllocation.updateMany({
            where: { id: { in: mine.map((a) => a.id) }, approvedById: null },
            data: { approvedById: actorId, approvedAt: now },
          }),
          "expense.alreadyAttested",
        );

        const remaining = await tx.expenseCostAllocation.count({
          where: { expenseId: expense.id, approvedById: null },
        });

        await tx.expenseEvent.create({
          data: { expenseId: expense.id, type: "COST_CENTER_APPROVED", actorId },
        });
        if (remaining === 0) {
          // The last signature: the utlägg must still be waiting for one.
          applied(
            await tx.expense.updateMany({
              where: { id: expense.id, status: "PENDING_APPROVAL" },
              data: { status: "APPROVED" },
            }),
          );
          await notify(tx, "EXPENSE_APPROVED", [expense.submitterId], about("approved"), {
            exclude: [actorId],
          });
          await notify(tx, "EXPENSE_READY_TO_BOOK", bookkeepers, about("readyToBook"), {
            exclude: [actorId, expense.submitterId],
          });
          return "APPROVED" as const;
        }
        await notify(
          tx,
          "EXPENSE_COST_CENTER_APPROVED",
          [expense.submitterId],
          about("costCenterApproved", {
            costCenter: mine.map((a) => `${a.costCenter.code} - ${a.costCenter.name}`).join(", "),
          }),
          { exclude: [actorId] },
        );
        return "PENDING_APPROVAL" as const;
      }),
    );
    if (result instanceof NextResponse) return result;
    deliverSoon();
    return NextResponse.json({ id, status: result });
  }

  // ── Withdraw your own attest ──────────────────────────────────────────────
  // Clears only the caller's own signatures. If the utlägg was APPROVED it drops back to PENDING_APPROVAL.
  if (action === "withdraw_attest") {
    if (!isAttestWithdrawable(expense.status)) {
      return expense.status === "BOOKED" || expense.status === "EXPORTED"
        ? fail(409, "expense.withdrawAfterBooked")
        : fail(409, "expense.nothingToWithdraw", {
            values: { status: { key: `common.status.${expense.status}` } },
          });
    }

    // Rows this user signed and may still attest (losing the authority ends the right to undo).
    const signed = expense.allocations.filter((a) => a.approvedById === actorId && mayAttest(a));
    // Narrowed to the picked rows, each one of the caller's own standing signatures.
    let mine = signed;
    if (allocationIds) {
      const picked = new Set(allocationIds);
      mine = signed.filter((a) => picked.has(a.id));
      if (mine.length < picked.size) return fail(403, "expense.noApprovalToWithdraw");
    }
    if (mine.length === 0) {
      return fail(403, "expense.noApprovalToWithdraw");
    }

    const withdrawn = await commit(() =>
      prisma.$transaction(async (tx) => {
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
        await notify(
          tx,
          "EXPENSE_ATTEST_WITHDRAWN",
          [expense.submitterId],
          about("attestWithdrawn"),
          {
            exclude: [actorId],
          },
        );
      }),
    );
    if (withdrawn instanceof NextResponse) return withdrawn;
    deliverSoon();

    return NextResponse.json({ id, status: "PENDING_APPROVAL" });
  }

  // ── Take your own submission back ─────────────────────────────────────────
  // Takes back the whole claim as a draft (the submitter's counterpart to withdraw_attest).
  if (action === "recall") {
    if (!actorIsSubmitter && !isAdmin(actor.capabilities)) {
      return fail(403, "expense.noRecallAccess");
    }
    if (!isRecallable(expense.status)) {
      // Once attested it is bookkeeping's to pull back (`return_approved`).
      return isSigned(expense.status)
        ? fail(409, "expense.recallAfterApproved")
        : fail(409, "expense.nothingToRecall", {
            values: { status: { key: `common.status.${expense.status}` } },
          });
    }

    const askedToAttest = await attesters();
    const recalled = await commit(() =>
      prisma.$transaction(async (tx) => {
        // Every signature, not only the actor's: an attest states the claim as it stood.
        await tx.expenseCostAllocation.updateMany({
          where: { expenseId: expense.id, approvedById: { not: null } },
          data: { approvedById: null, approvedAt: null },
        });
        // Conditional on the status it was read at, so a concurrent approval is not quietly overridden.
        applied(
          await tx.expense.updateMany({
            where: { id: expense.id, status: "PENDING_APPROVAL" },
            data: { status: "DRAFT" },
          }),
        );
        // The reference is kept (claimReference only draws for an utlägg that has none).
        await tx.expenseEvent.create({
          data: {
            expenseId: expense.id,
            type: "RECALLED",
            actorId,
            comment: comment || null,
          },
        });
        await notify(tx, "EXPENSE_RECALLED", askedToAttest, about("recalled"), {
          exclude: [actorId],
        });
      }),
    );
    if (recalled instanceof NextResponse) return recalled;
    deliverSoon();

    return NextResponse.json({ id, status: "DRAFT" });
  }

  // ── Return a wrongly-approved expense for changes ─────────────────────────
  // Bookkeeping roles reopen an attested utlägg to CHANGES_REQUESTED, clearing all approvals.
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
        await notify(
          tx,
          "EXPENSE_CHANGES_REQUESTED",
          [expense.submitterId],
          about("changesRequested"),
          {
            exclude: [actorId],
          },
        );
      }),
    );
    if (reopened instanceof NextResponse) return reopened;
    deliverSoon();
    return NextResponse.json({ id, status: "CHANGES_REQUESTED" });
  }

  // Undo an export: EXPORTED -> BOOKED, clearing the Fortnox voucher reference.
  // Only OUR record is unwound. The voucher in Fortnox stays and must be removed by hand, or the next export makes a second one.
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
    const bookkeepers = await holdersOf("BOOKKEEPING");
    const reverted = await commit(() =>
      prisma.$transaction(async (tx) => {
        // Still exported when the write lands, so two people undoing do not both succeed.
        applied(
          await tx.expense.updateMany({
            where: { id: expense.id, status: "EXPORTED" },
            data: {
              status: "BOOKED",
              // The stored cover goes with the export: it names the attestations being amended (lib/expense/document.ts).
              // The object is left for the sweeper, since this runs inside the transaction.
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
        await notify(tx, "EXPENSE_EXPORT_REVERTED", bookkeepers, about("exportReverted"), {
          exclude: [actorId],
        });
      }),
    );
    if (reverted instanceof NextResponse) return reverted;
    deliverSoon();
    return NextResponse.json({ id, status: "BOOKED" });
  }

  // ── Dispens från redovisningsfristen ──────────────────────────────────────
  // An eget utlägg handed in after REIMBURSEMENT_DEADLINE_DAYS is not reimbursed. This is the section deciding to take one anyway.
  // Required: the capability (the skattmästare's), a status not yet sent for attest (the deadline keeps late claims out of the queue),
  // an actually late claim, and a reason (the utläggsräkning prints it).
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
              // Optional here, unlike on the grant: taking a dispens back returns to the known rule.
              comment: comment || null,
            },
          });
          await notify(
            tx,
            "EXPENSE_DEADLINE_WAIVER_REVOKED",
            [expense.submitterId],
            about("waiverRevoked", { days: REIMBURSEMENT_DEADLINE_DAYS }),
            { exclude: [actorId] },
          );
        }),
      );
      if (revoked instanceof NextResponse) return revoked;
      deliverSoon();
      return NextResponse.json({ id, deadlineWaived: false });
    }

    // A draft with no date yet is unfinished, not late (`isLateReimbursement` wants a whole date).
    const purchaseDate = expense.purchaseDate ? isoDay(expense.purchaseDate) : "";
    if (!isLateReimbursement(purchaseDate, expense.paymentType)) {
      return fail(422, "expense.nothingToWaive", {
        values: { days: REIMBURSEMENT_DEADLINE_DAYS },
      });
    }
    if (!comment) return fail(422, "expense.commentRequiredWaive");
    if (expense.deadlineWaivedAt) return fail(409, "expense.alreadyWaived");

    const waived = await commit(() =>
      prisma.$transaction(async (tx) => {
        // Not yet waived and not yet sent, so two simultaneous grants do not overwrite each other.
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
        await notify(tx, "EXPENSE_DEADLINE_WAIVED", [expense.submitterId], about("waived"), {
          exclude: [actorId],
        });
      }),
    );
    if (waived instanceof NextResponse) return waived;
    deliverSoon();
    return NextResponse.json({ id, deadlineWaived: true });
  }

  // ── Simple state-machine transitions ──────────────────────────────────────
  const rule = SIMPLE_TRANSITIONS[action];
  if (!rule.from.includes(expense.status)) {
    return fail(409, "expense.actionNotFromStatus", {
      values: { status: { key: `common.status.${expense.status}` } },
    });
  }
  if (action === "submit") {
    // Sending for attest is the submitter's act; an admin may do it on their behalf. Mirrors `mayAct` in lib/domain/expense-capabilities.ts.
    if (!actorIsSubmitter && !isAdmin(actor.capabilities)) {
      return fail(403, "expense.noSubmitAccess");
    }
    if (!expense.title.trim() || expense.purchaseDate === null || expense.grossAmount === null) {
      return fail(422, "expense.incomplete");
    }
    // A future day is not a purchase. PATCH refuses to store one, so this catches older rows.
    // @db.Date is midnight UTC, so the ISO day is the day meant.
    if (isFutureDate(isoDay(expense.purchaseDate))) {
      return fail(422, "expense.futureDate");
    }
    // An eget utlägg handed in more than 60 days after the purchase never enters the attest queue,
    // unless the skattmästare gave a dispens (see the branch below).
    if (
      !expense.deadlineWaivedAt &&
      isLateReimbursement(isoDay(expense.purchaseDate), expense.paymentType)
    ) {
      return fail(422, "expense.reimbursementTooLate", {
        values: { days: REIMBURSEMENT_DEADLINE_DAYS },
      });
    }
    // The underlag is required here, the wizard's check being only a convenience.
    // A milersättning's journey is its underlag: where it went and how far, at a rate the day can be priced at (lib/mileage/claim.ts).
    if (expense.paymentType === "MILEAGE") {
      const blocker = claimBlocker(
        {
          // Whole and not in the future by the checks above.
          date: isoDay(expense.purchaseDate),
          odometerStart: expense.odometerStart == null ? null : Number(expense.odometerStart),
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
    // The amount can change after the match, so the pair is checked again.
    if (
      expense.matchedTransaction &&
      !cancelsOut(expense.matchedTransaction.amount, expense.grossAmount)
    ) {
      return fail(422, "expense.matchStale");
    }
    // Out-of-pocket claims (milersättning too) need the submitter's payout account.
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
  // Only someone who may attest at least one allocation can send it back.
  if (action === "request_changes" && !expense.allocations.some(mayAttest)) {
    return fail(403, "expense.noRequestChangesAccess");
  }
  if (rule.requireComment && !comment) {
    return fail(422, "expense.commentRequired");
  }

  // Asked before the transaction, which does not touch the authority tables.
  const askedToAttest = action === "submit" ? await attesters() : [];
  const written = await commit(() =>
    withReferenceRetry(() =>
      prisma.$transaction(async (tx) => {
        if (rule.to === "CHANGES_REQUESTED") {
          await tx.expenseCostAllocation.updateMany({
            where: { expenseId: expense.id },
            data: { approvedById: null, approvedAt: null },
          });
        }
        // The number, on submit only and only once: a re-submitted utlägg keeps its number.
        const reference =
          action === "submit" && expense.reference === null ? await claimReference(tx) : undefined;
        // The status must still be the one permitted from, or a second submit would find the reference already claimed.
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
        if (action === "submit") {
          // With the number it was just given, which the attester finds it under.
          await notify(
            tx,
            "EXPENSE_SUBMITTED",
            askedToAttest,
            about("submitted", {}, reference ?? expense.reference),
            { exclude: [actorId, expense.submitterId] },
          );
        } else {
          await notify(
            tx,
            "EXPENSE_CHANGES_REQUESTED",
            [expense.submitterId],
            about("changesRequested"),
            {
              exclude: [actorId],
            },
          );
        }
        return reference ?? expense.reference;
      }),
    ),
  );
  if (written instanceof NextResponse) return written;
  deliverSoon();

  return NextResponse.json({ id, reference: written, status: rule.to });
}
