// Create a DRAFT expense, so the upload wizard has something to attach the receipt to (Receipt.expenseId is required).
import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { fail, gate } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { CreateExpense } from "@/lib/api/schemas/expense";
import { isMatchable } from "@/lib/domain/matching";
import { isQuietDraftEdit } from "@/lib/domain/status";

// POST /api/expenses: body: { paymentType?, title?, matchedTransactionId? }
export async function POST(req: Request) {
  const g = await gate();
  if (!g.ok) return g.res;
  const submitterId = g.actor.id;

  const parsed = await parseBody(req, CreateExpense);
  if (!parsed.ok) return parsed.res;
  const { paymentType, title } = parsed.data;
  const matchedTransactionId = parsed.data.matchedTransactionId ?? null;

  if (paymentType === "CARD") {
    const holds = await prisma.card.count({ where: { holderId: submitterId } });
    if (holds === 0) return fail(403, "expense.noCard");
  }

  // Optional pre-match from the "Redovisa" deep-link. An eget utlägg carrying a match is the section paying twice (see isMatchable),
  // so it is refused here, before anything about the transaction. Same answer the match step gives.
  if (matchedTransactionId) {
    if (!isMatchable(paymentType)) return fail(422, "expense.matchCardOnly");
    const txn = await prisma.bankTransaction.findUnique({
      where: { id: matchedTransactionId },
      include: {
        matchedExpense: { select: { id: true } },
        card: { select: { holderId: true } },
      },
    });
    if (!txn) return fail(422, "bank.txnNotFound");
    if (txn.matchedExpense) {
      return fail(409, "bank.txnAlreadyLinked");
    }
    if (txn.card?.holderId !== submitterId) {
      return fail(403, "bank.txnNotYourCard");
    }
  }

  // No reference yet: numbering a draft would make every abandoned upload burn a number.
  // It is handed out on submit (expenses/[id]/transition/route.ts).
  const expense = await prisma.$transaction(async (tx) => {
    const created = await tx.expense.create({
      data: { title, submitterId, paymentType, status: "DRAFT", matchedTransactionId },
    });
    await tx.expenseEvent.create({
      data: { expenseId: created.id, type: "CREATED", actorId: submitterId },
    });
    // A pre-match from the deep-link is part of creating the row (isQuietDraftEdit).
    if (matchedTransactionId && !isQuietDraftEdit(created, submitterId)) {
      await tx.expenseEvent.create({
        data: { expenseId: created.id, type: "MATCHED", actorId: submitterId },
      });
    }
    return created;
  });

  return NextResponse.json({ id: expense.id }, { status: 201 });
}
