// Bank transactions, and the section cards they were made on. The two belong
// together: a transaction is placed on a card by its number, and a card is
// mostly interesting for the purchases hanging off it.
import "server-only";

import { prisma } from "@/lib/server/db";
import type { During } from "@/lib/server/fiscal-year";
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

// Pass `cardHolderId` to get only the purchases on that member's own card.
// the bank table is the largest in the app, so this filters in the DB rather
// than shipping every row to the caller. It is also what keeps the whole
// section's bank feed off a page that only needs one member's purchases: a page
// ships what it asks for, so asking for everything publishes everything.
//
// `alsoIds` carries the rows a screen must show whoever is looking (the
// transaction an utlägg is already matched to) past that filter. Same shape as
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

/**
 * The named transactions and nothing else.
 *
 * For a screen that must show the row a record points at without being allowed
 * to browse: the utlägg detail page shows what an expense was matched to
 * whoever is looking, but only offers the picker to someone who may change it.
 *
 * Its own function rather than `getBankTransactions({ alsoIds })`, because that
 * call reads as "these as well as nothing" and means "the whole feed": the
 * filter there is the holder, and `alsoIds` only widens it. An empty list in,
 * an empty list out; there is no way to ask this one for everything.
 */
export async function getBankTransactionsByIds(
  ids: readonly string[],
): Promise<BankTransaction[]> {
  const wanted = ids.filter(Boolean);
  if (wanted.length === 0) return [];
  const txns = await prisma.bankTransaction.findMany({
    where: { id: { in: [...wanted] } },
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
  cardId: string | null;
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
    cardId: t.cardId ?? undefined,
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

// transactionDate is a date, so same-day purchases tie, hence the tiebreaker.
const BANK_DEFAULT_ORDER: Prisma.BankTransactionOrderByWithRelationInput[] = [
  { transactionDate: "desc" },
  { id: "desc" },
];

/**
 * One page of the bank feed, and how many rows are behind it.
 *
 * `scope` narrows to a member's own card purchases, or to the cards spent for
 * some result units (a resultatansvarig's reading). Neither is the whole feed,
 * for bookkeeping.
 * Whether a row is accounted for is a tab rather than a search: it is the
 * question this screen exists to answer.
 */
export async function getBankTransactionPage(
  scope: { cardHolderId?: string; resultUnitNames?: readonly string[] },
  q: ListQuery,
  /** The räkenskapsår, by transaction date. See docs/navigation.md. */
  { during }: { during?: During } = {},
): Promise<RowPage<BankTransaction>> {
  const and: Prisma.BankTransactionWhereInput[] = [];
  if (during) and.push({ transactionDate: during });
  if (scope.cardHolderId) and.push({ card: { holderId: scope.cardHolderId } });
  // The cards spent for these result units. An empty list is no cards, not
  // every card: it narrows to nothing rather than falling through to the feed.
  if (scope.resultUnitNames) {
    and.push({ card: { resultUnit: { name: { in: [...scope.resultUnitNames] } } } });
  }

  // `is: null` / `isNot: null` on a one-to-one relation, which is how "has an
  // utlägg against it" is asked of the database rather than of a loaded row.
  if (q.tab === "accounted") and.push({ matchedExpense: { isNot: null } });
  if (q.tab === "unaccounted") and.push({ matchedExpense: { is: null } });
  // On no card: on nobody's own feed, so only ever asked for on the section's.
  if (q.tab === "nocard") and.push({ cardId: null });
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

/**
 * The purchases the import could place on no card: the Referens carried no
 * K#### token, so they sit outside every member's own feed until somebody says
 * whose they were. Every one of them, not a page: it is a job that is worked
 * down to nothing, so the list is short whenever anyone is keeping up with it.
 */
/** How many purchases the export named no card on, for bookkeeping to place. */
export async function countCardlessTransactions({ during }: { during?: During } = {}): Promise<number> {
  return prisma.bankTransaction.count({
    where: { cardId: null, ...(during ? { transactionDate: during } : {}) },
  });
}

/** How many of a member's own card purchases have no utlägg yet. */
export async function countUnaccountedPurchases(
  holderId: string,
  { during }: { during?: During } = {},
): Promise<number> {
  return prisma.bankTransaction.count({
    where: { card: { holderId }, matchedExpense: { is: null }, ...(during ? { transactionDate: during } : {}) },
  });
}

export async function getCards(opts: { holderId?: string } = {}): Promise<Card[]> {
  const cards = await prisma.card.findMany({
    where: opts.holderId ? { holderId: opts.holderId } : {},
    orderBy: { last4: "asc" },
    include: {
      holder: true,
      resultUnit: { select: { name: true } },
      _count: { select: { transactions: true } },
    },
  });
  return cards.map((c) => ({
    id: c.id,
    last4: c.last4,
    holderId: c.holderId ?? undefined,
    holderName: c.holder?.name,
    resultUnitId: c.resultUnitId ?? undefined,
    resultUnitName: c.resultUnit?.name,
    active: c.active,
    txCount: c._count.transactions,
  }));
}
