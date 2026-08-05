// Bank transactions, and the section cards they were made on. The two belong
// together: a transaction is placed on a card by its number, and a card is
// mostly interesting for the purchases hanging off it.
import "server-only";

import { prisma } from "@/lib/server/db";
import { oreToSEK as ore } from "@/lib/domain/money";
import type { BankTransaction, Card } from "@/lib/domain/types";
import { isoDate } from "./shared";

// Pass `cardHolderId` to get only the purchases on that member's own card —
// the bank table is the largest in the app, so this filters in the DB rather
// than shipping every row to the caller. It is also what keeps the whole
// section's bank feed off a page that only needs one member's purchases: a page
// ships what it asks for, so asking for everything publishes everything.
//
// `alsoIds` carries the rows a screen must show whoever is looking — the
// transaction an utlägg is already matched to — past that filter. Same shape as
// the book page's `getActiveAccounts([...])`: narrow by rule, then add back
// what the record already points at.
export async function getBankTransactions(
  opts: { cardHolderId?: string; alsoIds?: readonly string[] } = {},
): Promise<BankTransaction[]> {
  const alsoIds = (opts.alsoIds ?? []).filter(Boolean);
  const scoped = opts.cardHolderId ? { card: { holderId: opts.cardHolderId } } : {};
  const txns = await prisma.bankTransaction.findMany({
    where:
      opts.cardHolderId && alsoIds.length
        ? { OR: [scoped, { id: { in: [...alsoIds] } }] }
        : scoped,
    // transactionDate is a date, so same-day purchases tie. Without a unique
    // tiebreaker Postgres may return tied rows in a different order per query,
    // which shows up as a hydration mismatch when the HTML and the RSC payload
    // come from two executions. Every non-unique ordering here needs one.
    orderBy: [{ transactionDate: "desc" }, { id: "desc" }],
    include: { matchedExpense: true, card: { include: { holder: true } } },
  });
  return txns.map((t) => ({
    id: t.id,
    transactionDate: isoDate(t.transactionDate),
    description: t.description,
    amount: ore(t.amount),
    matchedExpenseId: t.matchedExpense?.id ?? undefined,
    matchedExpenseRef: t.matchedExpense?.reference ?? undefined,
    cardLast4: t.cardLast4 ?? t.card?.last4 ?? undefined,
    cardHolderId: t.card?.holderId ?? undefined,
    cardHolderName: t.card?.holder?.name ?? undefined,
  }));
}

export async function getCards(): Promise<Card[]> {
  const cards = await prisma.card.findMany({
    orderBy: { last4: "asc" },
    include: { holder: true, _count: { select: { transactions: true } } },
  });
  return cards.map((c) => ({
    id: c.id,
    last4: c.last4,
    holderId: c.holderId ?? undefined,
    holderName: c.holder?.name,
    active: c.active,
    txCount: c._count.transactions,
  }));
}
