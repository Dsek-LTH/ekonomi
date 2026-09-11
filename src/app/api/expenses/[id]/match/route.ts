// Set or clear the bank-transaction match on a CARD expense. Only allowed
// while the expense is still pre-submission (DRAFT / PENDING_MATCH /
// CHANGES_REQUESTED). The [id] param is the expense id.
import { prisma } from "@/lib/server/db";
import { isQuietDraftEdit, isSubmittable } from "@/lib/domain/status";
import { fail, gate } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { MatchExpense } from "@/lib/api/schemas/expense";
import { canEditExpense, denyExpenseView } from "@/lib/api/expense-access";
import { cancelsOut, isMatchable } from "@/lib/domain/matching";
import { formatSEK } from "@/lib/ui/format";
import { oreToSEK } from "@/lib/domain/money";
import { expenseLabel } from "@/lib/domain/reference";

// POST /api/expenses/:id/match
// body: { transactionId: string }  → match
// body: { transactionId: null }    → unmatch
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await gate();
  if (!g.ok) return g.res;
  const parsed = await parseBody(req, MatchExpense);
  if (!parsed.ok) return parsed.res;
  const body = parsed.data;

  const expense = await prisma.expense.findUnique({ where: { id } });
  if (!expense) return fail(404, "expense.notFound");

  // Out of scope is not found, as everywhere else. A 403 here would confirm
  // that this utlägg exists, which is the one thing the view rule is meant to
  // withhold.
  const hidden = await denyExpenseView(g.actor, expense);
  if (hidden) return hidden;

  // The match is part of the utlägg's own figures, so it follows the edit rule
  // rather than the view rule.
  if (!canEditExpense(g.actor, expense)) return fail(403, "expense.noEditAccess");
  if (!isSubmittable(expense.status)) {
    return fail(409, "expense.matchLocked");
  }
  if (!isMatchable(expense.paymentType)) {
    return fail(422, "expense.matchCardOnly");
  }

  // A transaction id, or null to unmatch. The schema insists it is one of the
  // two, so the third case this used to carry (a body that named neither, and
  // its own 422) cannot arrive.
  const transactionId = body.transactionId;

  // Already the answer: the wizard sends the match it already holds on every
  // save, whether or not this step is the one that changed it, and re-writing
  // the same id was logging a MATCHED nobody caused, right beside the one the
  // create step (or an earlier save) had already written.
  if (transactionId === expense.matchedTransactionId) {
    return new Response(null, { status: 204 });
  }

  if (transactionId !== null) {
    // Validate the transaction exists, belongs to the submitter's own section
    // card, and isn't already taken by another expense.
    const txn = await prisma.bankTransaction.findUnique({
      where: { id: transactionId },
      include: {
        matchedExpense: { select: { id: true, reference: true } },
        card: { select: { holderId: true } },
      },
    });
    if (!txn) return fail(422, "bank.txnNotFound");
    if (txn.card?.holderId !== expense.submitterId) {
      return fail(403, "bank.txnNotExpenseCard");
    }
    if (txn.matchedExpense && txn.matchedExpense.id !== id) {
      return fail(409, "bank.txnLinkedTo", {
        values: { reference: expenseLabel(txn.matchedExpense) },
      });
    }
    // Both in öre, so this is an exact comparison.
    if (expense.grossAmount === null) {
      return fail(422, "expense.amountBeforeMatch");
    }
    if (!cancelsOut(txn.amount, expense.grossAmount)) {
      return fail(422, "bank.amountMismatch", {
        values: {
          expense: formatSEK(oreToSEK(expense.grossAmount)),
          transaction: formatSEK(oreToSEK(txn.amount)),
        },
      });
    }
  }

  const eventType = transactionId ? "MATCHED" : "UNMATCHED";

  await prisma.$transaction(async (tx) => {
    await tx.expense.update({
      where: { id: expense.id },
      data: { matchedTransactionId: transactionId },
    });
    // Quiet before the first submission; see isQuietDraftEdit.
    if (!isQuietDraftEdit(expense, g.actor.id)) {
      await tx.expenseEvent.create({
        data: { expenseId: expense.id, type: eventType, actorId: g.actor.id },
      });
    }
  });

  return new Response(null, { status: 204 });
}
