// Create a DRAFT expense. The upload wizard calls this first so it has an
// expense to attach the receipt to (Receipt.expenseId is required).
import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { fail, gate } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { CreateExpense } from "@/lib/api/schemas/expense";
import { isMatchable } from "@/lib/domain/matching";

// POST /api/expenses: body: { paymentType?, title?, matchedTransactionId? }
export async function POST(req: Request) {
  const g = await gate();
  if (!g.ok) return g.res;
  const submitterId = g.actor.id;

  const parsed = await parseBody(req, CreateExpense);
  if (!parsed.ok) return parsed.res;
  const { paymentType, title } = parsed.data;
  const matchedTransactionId = parsed.data.matchedTransactionId ?? null;

  // A card purchase ("Sektionskort") is only available to members who hold a card.
  if (paymentType === "CARD") {
    const holds = await prisma.card.count({ where: { holderId: submitterId } });
    if (holds === 0) return fail(403, "expense.noCard");
  }

  // Optional pre-match to a bank transaction (from the "Redovisa" deep-link).
  if (matchedTransactionId) {
    // Before anything about the transaction itself: an eget utlägg carrying a
    // match is the section paying for the purchase twice (see isMatchable).
    // The deep-link opens the wizard on "Sektionskort" and no longer lets it
    // be changed, so nothing we ship sends this, which is exactly why it is
    // refused here rather than assumed. Same answer the match step gives.
    if (!isMatchable(paymentType)) return fail(422, "expense.matchCardOnly");
    const txn = await prisma.bankTransaction.findUnique({
      where: { id: matchedTransactionId },
      include: { matchedExpense: { select: { id: true } }, card: { select: { holderId: true } } },
    });
    if (!txn) return fail(422, "bank.txnNotFound");
    if (txn.matchedExpense) {
      return fail(409, "bank.txnAlreadyLinked");
    }
    // You can only match a purchase made with your own section card.
    if (txn.card?.holderId !== submitterId) {
      return fail(403, "bank.txnNotYourCard");
    }
  }

  // No reference yet. A draft is not a claim on the section. It is someone
  // part-way through the wizard, and numbering it here means every abandoned
  // upload takes a number out of the year's sequence for good. The number is
  // handed out when the utlägg is submitted for attest; see the `submit` branch
  // in expenses/[id]/transition/route.ts. Until then the row is known by its id,
  // which is what every page and route is keyed on anyway.
  const expense = await prisma.$transaction(async (tx) => {
    const created = await tx.expense.create({
      data: { title, submitterId, paymentType, status: "DRAFT", matchedTransactionId },
    });
    await tx.expenseEvent.create({
      data: { expenseId: created.id, type: "CREATED", actorId: submitterId },
    });
    if (matchedTransactionId) {
      await tx.expenseEvent.create({
        data: { expenseId: created.id, type: "MATCHED", actorId: submitterId },
      });
    }
    return created;
  });

  return NextResponse.json({ id: expense.id }, { status: 201 });
}
