// Create a DRAFT expense. The upload wizard calls this first so it has an
// expense to attach the receipt to (Receipt.expenseId is required).
import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { fail, gate } from "@/lib/api/guard";

// A unique-constraint violation, which for this route can only be two people
// claiming the same reference at once. Duck-typed rather than imported: the
// code is Prisma's public contract for it and this is the only thing here that
// cares which error it was.
const isUniqueViolation = (e: unknown) =>
  typeof e === "object" && e !== null && (e as { code?: unknown }).code === "P2002";

async function withReferenceRetry<T>(run: () => Promise<T>, attempts = 5): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await run();
    } catch (e) {
      if (i >= attempts || !isUniqueViolation(e)) throw e;
    }
  }
}

// POST /api/expenses — body: { paymentType?, title?, matchedTransactionId? }
export async function POST(req: Request) {
  const g = await gate();
  if (!g.ok) return g.res;
  const submitterId = g.actor.id;

  const body = await req.json().catch(() => ({}));
  const paymentType = body.paymentType === "REIMBURSEMENT" ? "REIMBURSEMENT" : "CARD";
  const title: string = typeof body.title === "string" ? body.title : "";
  const matchedTransactionId =
    typeof body.matchedTransactionId === "string" ? body.matchedTransactionId : null;

  // A card purchase ("Sektionskort") is only available to members who hold a card.
  if (paymentType === "CARD") {
    const holds = await prisma.card.count({ where: { holderId: submitterId } });
    if (holds === 0) return fail(403, "expense.noCard");
  }

  // Optional pre-match to a bank transaction (from the "Redovisa" deep-link).
  if (matchedTransactionId) {
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

  const create = () =>
    prisma.$transaction(async (tx) => {
      const prefix = `U-${new Date().getFullYear()}-`;
      const last = await tx.expense.findFirst({
        where: { reference: { startsWith: prefix } },
        orderBy: { reference: "desc" },
        select: { reference: true },
      });
      const nextNum = last ? parseInt(last.reference.slice(prefix.length), 10) + 1 : 1;
      const reference = `${prefix}${String(nextNum).padStart(4, "0")}`;

      const created = await tx.expense.create({
        data: { reference, title, submitterId, paymentType, status: "DRAFT", matchedTransactionId },
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

  // The reference is read-then-written, and two people filing an utlägg in the
  // same moment both read the same "last" one. `Expense.reference` is unique, so
  // the loser hits a constraint violation rather than stealing the number — the
  // right outcome, but a 500 for someone who did nothing wrong. Take the number
  // again instead. A handful of attempts covers any burst the section can
  // produce; giving up is better than looping if something else is wrong.
  const expense = await withReferenceRetry(create);

  return NextResponse.json(
    { id: expense.id, reference: expense.reference },
    { status: 201 },
  );
}
