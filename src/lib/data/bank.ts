// Bank transactions, and the section cards they were made on. The two belong
// together: a transaction is placed on a card by its number, and a card is
// mostly interesting for the purchases hanging off it.
import "server-only";

import { prisma } from "@/lib/server/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { oreToSEK as ore } from "@/lib/domain/money";
import type { BankTransaction, Card } from "@/lib/domain/types";
import {
  dateRangeFilter,
  pageBounds,
  type ListQuery,
  type RowPage,
  type SortDir,
} from "./list-query";
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
  return txns.map(toBankTransaction);
}

// One row as the UI shape. Shared by the paged screen query and the unpaged
// loader above, so the two can't disagree about what a transaction is.
type BankRow = {
  id: string;
  transactionDate: Date;
  description: string;
  amount: number;
  cardLast4: string | null;
  matchedExpense: { id: string; reference: string | null } | null;
  card: { last4: string; holderId: string | null; holder: { name: string } | null } | null;
};

function toBankTransaction(t: BankRow): BankTransaction {
  return {
    id: t.id,
    transactionDate: isoDate(t.transactionDate),
    description: t.description,
    amount: ore(t.amount),
    matchedExpenseId: t.matchedExpense?.id ?? undefined,
    matchedExpenseRef: t.matchedExpense?.reference ?? undefined,
    cardLast4: t.cardLast4 ?? t.card?.last4 ?? undefined,
    cardHolderId: t.card?.holderId ?? undefined,
    cardHolderName: t.card?.holder?.name ?? undefined,
  };
}

// Pass `holderId` for just that member's cards. Same rule as the transactions
// above: the card list carries every holder's name, so a page that only needs
// to know which cards are *yours* must not ask for the whole register.
// Sortable columns, as orders the database can take. Every one ends in `id`,
// for the reason given in expenses.ts: a page is a window onto an ordering, and
// an ordering with ties is a window that can repeat a row and drop another.
const BANK_ORDER: Record<string, (dir: SortDir) => Prisma.BankTransactionOrderByWithRelationInput[]> = {
  date: (d) => [{ transactionDate: d }, { id: d }],
  description: (d) => [{ description: d }, { id: d }],
  amount: (d) => [{ amount: d }, { id: d }],
  holder: (d) => [{ card: { holder: { name: d } } }, { id: d }],
  card: (d) => [{ cardLast4: d }, { id: d }],
};

// transactionDate is a date, so same-day purchases tie — hence the tiebreaker.
const BANK_DEFAULT_ORDER: Prisma.BankTransactionOrderByWithRelationInput[] = [
  { transactionDate: "desc" },
  { id: "desc" },
];

/**
 * One page of the bank feed, and how many rows are behind it.
 *
 * `scope` is the same narrowing `getBankTransactions` takes and means the same
 * thing — a member's own card purchases, or the whole feed for bookkeeping.
 * Whether a row is accounted for is a tab rather than a search: it is the
 * question this screen exists to answer.
 */
export async function getBankTransactionPage(
  scope: { cardHolderId?: string },
  q: ListQuery,
): Promise<RowPage<BankTransaction>> {
  const and: Prisma.BankTransactionWhereInput[] = [];
  if (scope.cardHolderId) and.push({ card: { holderId: scope.cardHolderId } });

  // `is: null` / `isNot: null` on a one-to-one relation, which is how "has an
  // utlägg against it" is asked of the database rather than of a loaded row.
  if (q.tab === "MATCHED" || q.tab === "matched") and.push({ matchedExpense: { isNot: null } });
  if (q.tab === "UNMATCHED" || q.tab === "unmatched") and.push({ matchedExpense: { is: null } });

  const date = dateRangeFilter(q, { dateOnly: true });
  if (date) and.push({ transactionDate: date });

  if (q.q) {
    and.push({
      OR: [
        { description: { contains: q.q, mode: "insensitive" } },
        { cardLast4: { contains: q.q, mode: "insensitive" } },
        { card: { holder: { name: { contains: q.q, mode: "insensitive" } } } },
        { matchedExpense: { reference: { contains: q.q, mode: "insensitive" } } },
      ],
    });
  }

  const where: Prisma.BankTransactionWhereInput = and.length ? { AND: and } : {};
  const { skip, take } = pageBounds(q);
  const order = BANK_ORDER[q.sort];

  const [txns, total] = await Promise.all([
    prisma.bankTransaction.findMany({
      where,
      orderBy: order ? order(q.dir) : BANK_DEFAULT_ORDER,
      skip,
      take,
      include: { matchedExpense: true, card: { include: { holder: true } } },
    }),
    prisma.bankTransaction.count({ where }),
  ]);

  return { rows: txns.map(toBankTransaction), total };
}

export async function getCards(opts: { holderId?: string } = {}): Promise<Card[]> {
  const cards = await prisma.card.findMany({
    where: opts.holderId ? { holderId: opts.holderId } : {},
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
