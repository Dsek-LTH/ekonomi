import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { canBookkeep } from "@/lib/domain/permissions";
import { fail, gate, orNotFound } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { PatchBankTransaction } from "@/lib/api/schemas/bank";
import { expenseLabel } from "@/lib/domain/reference";

const bookkeeping = () => gate(canBookkeep, "auth.denied");

/**
 * PATCH /api/bank/:id: body `{ cardId: string | null }`. Put a purchase on a section card, or take it off one.
 * Bookkeeper/admin only. For purchases the import could not place (no K#### token in the Referens). `cardLast4`
 * follows the card, or a row would read as one card's and count as another's.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await bookkeeping();
  if (!g.ok) return g.res;

  const parsed = await parseBody(req, PatchBankTransaction);
  if (!parsed.ok) return parsed.res;

  const txn = await prisma.bankTransaction.findUnique({
    where: { id },
    include: { matchedExpense: { select: { id: true, reference: true } } },
  });
  if (!txn) return fail(404, "bank.txnNotFound");

  // A match needs the submitter's own card (see /api/expenses/[id]/match), so moving the card under a matched row
  // would leave an impossible match: it comes off first.
  if (txn.matchedExpense) {
    return fail(409, "bank.txnMatched", {
      values: { reference: expenseLabel(txn.matchedExpense) },
    });
  }

  let data: { cardId: string | null; cardLast4: string | null } = {
    cardId: null,
    cardLast4: null,
  };
  if (parsed.data.cardId) {
    const card = await prisma.card.findUnique({ where: { id: parsed.data.cardId } });
    if (!card) return fail(422, "card.notFound");
    data = { cardId: card.id, cardLast4: card.last4 };
  }

  const updated = await orNotFound(
    () => prisma.bankTransaction.update({ where: { id }, data }),
    "bank.txnNotFound",
  );
  if (updated instanceof NextResponse) return updated;

  return new Response(null, { status: 204 });
}

// DELETE /api/bank/:id: bookkeeper/admin only. Refuses if the transaction is
// matched to an expense (caller must unmatch first).
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await bookkeeping();
  if (!g.ok) return g.res;

  const txn = await prisma.bankTransaction.findUnique({
    where: { id },
    include: { matchedExpense: { select: { id: true, reference: true } } },
  });
  if (!txn) return fail(404, "notFound");

  if (txn.matchedExpense) {
    return fail(409, "bank.txnMatched", {
      values: { reference: expenseLabel(txn.matchedExpense) },
    });
  }

  await prisma.bankTransaction.delete({ where: { id } });
  return new Response(null, { status: 204 });
}
