// Set or clear the bank-transaction match on a CARD expense. Only allowed
// while the expense is still pre-submission (DRAFT / PENDING_MATCH /
// CHANGES_REQUESTED). The [id] param is the human reference.
import { prisma } from "@/lib/server/db";
import { isSubmittable } from "@/lib/domain/status";
import { fail, gate } from "@/lib/api/guard";
import { canEditExpense, denyExpenseView } from "@/lib/api/expense-access";
import { cancelsOut } from "@/lib/domain/matching";
import { formatSEK } from "@/lib/ui/format";
import { oreToSEK } from "@/lib/domain/money";

// POST /api/expenses/:id/match
// body: { transactionId: string }  → match
// body: { transactionId: null }    → unmatch
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: reference } = await ctx.params;
  const g = await gate();
  if (!g.ok) return g.res;
  const body = await req.json().catch(() => ({}));

  const expense = await prisma.expense.findUnique({ where: { reference } });
  if (!expense) return fail(404, "expense.notFound");

  // Out of scope is not found, as everywhere else — a 403 here would confirm
  // that an utlägg with this reference exists, which is the one thing the view
  // rule is meant to withhold.
  const hidden = await denyExpenseView(g.actor, expense);
  if (hidden) return hidden;

  // The match is part of the utlägg's own figures, so it follows the edit rule
  // rather than the view rule.
  if (!canEditExpense(g.actor, expense)) return fail(403, "expense.noEditAccess");
  if (!isSubmittable(expense.status)) {
    return fail(409, "expense.matchLocked");
  }
  if (expense.paymentType !== "CARD") {
    return fail(422, "expense.matchCardOnly");
  }

  const transactionId =
    body.transactionId === null || body.transactionId === ""
      ? null
      : typeof body.transactionId === "string"
        ? body.transactionId
        : undefined;

  if (transactionId === undefined) return fail(422, "request.transactionIdRequired");

  if (transactionId !== null) {
    // Validate the transaction exists, belongs to the submitter's own section
    // card, and isn't already taken by another expense.
    const txn = await prisma.bankTransaction.findUnique({
      where: { id: transactionId },
      include: { matchedExpense: { select: { reference: true } }, card: { select: { holderId: true } } },
    });
    if (!txn) return fail(422, "bank.txnNotFound");
    if (txn.card?.holderId !== expense.submitterId) {
      return fail(403, "bank.txnNotExpenseCard");
    }
    if (txn.matchedExpense && txn.matchedExpense.reference !== reference) {
      return fail(409, "bank.txnLinkedTo", {
        values: { reference: txn.matchedExpense.reference },
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
    await tx.expenseEvent.create({
      data: { expenseId: expense.id, type: eventType, actorId: g.actor.id },
    });
  });

  return new Response(null, { status: 204 });
}
