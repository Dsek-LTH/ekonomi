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

// `cardHolderId` filters to that member's own card purchases in the DB, so a page never ships the whole feed.
// `alsoIds` adds back rows the screen must show regardless (e.g. the transaction an utlägg is matched to).
export async function getBankTransactions(
  opts: { cardHolderId?: string; alsoIds?: readonly string[] } = {},
): Promise<BankTransaction[]> {
  const alsoIds = (opts.alsoIds ?? []).filter(Boolean);
  const scoped = opts.cardHolderId ? { card: { holderId: opts.cardHolderId } } : {};
  const txns = await prisma.bankTransaction.findMany({
    where:
      opts.cardHolderId && alsoIds.length ? { OR: [scoped, { id: { in: [...alsoIds] } }] } : scoped,
    // Same-day purchases tie on transactionDate, hence the `id` tiebreaker.
    orderBy: [{ transactionDate: "desc" }, { id: "desc" }],
    include: { matchedExpense: true, card: { include: { holder: true } } },
  });
  return txns.map(toBankTransaction);
}

/**
 * The named transactions and nothing else, for showing the row a record points at without allowing
 * browsing. Not `getBankTransactions({ alsoIds })`, which would return the whole feed.
 */
export async function getBankTransactionsByIds(ids: readonly string[]): Promise<BankTransaction[]> {
  const wanted = ids.filter(Boolean);
  if (wanted.length === 0) return [];
  const txns = await prisma.bankTransaction.findMany({
    where: { id: { in: [...wanted] } },
    orderBy: [{ transactionDate: "desc" }, { id: "desc" }],
    include: { matchedExpense: true, card: { include: { holder: true } } },
  });
  return txns.map(toBankTransaction);
}

// Shared by the paged query and the unpaged loader.
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

// Sortable columns; every one ends in `id` so ties cannot repeat or drop a row across pages.
const BANK_ORDER: Record<
  string,
  (dir: SortDir) => Prisma.BankTransactionOrderByWithRelationInput[]
> = {
  date: (d) => [{ transactionDate: d }, { id: d }],
  description: (d) => [{ description: d }, { id: d }],
  amount: (d) => [{ amount: d }, { id: d }],
  holder: (d) => [{ card: { holder: { name: d } } }, { id: d }],
  card: (d) => [{ cardLast4: d }, { id: d }],
};

const BANK_DEFAULT_ORDER: Prisma.BankTransactionOrderByWithRelationInput[] = [
  { transactionDate: "desc" },
  { id: "desc" },
];

/**
 * One page of the bank feed. `scope` narrows to a member's own card purchases or to the cards spent
 * for some result units; bookkeeping gets the whole feed.
 */
export async function getBankTransactionPage(
  scope: { cardHolderId?: string; resultUnitNames?: readonly string[] },
  q: ListQuery,
  /** The räkenskapsår, by transaction date. */
  { during }: { during?: During } = {},
): Promise<RowPage<BankTransaction>> {
  const and: Prisma.BankTransactionWhereInput[] = [];
  if (during) and.push({ transactionDate: during });
  if (scope.cardHolderId) and.push({ card: { holderId: scope.cardHolderId } });
  // An empty list means no cards, not every card.
  if (scope.resultUnitNames) {
    and.push({ card: { resultUnit: { name: { in: [...scope.resultUnitNames] } } } });
  }

  // `is: null` / `isNot: null` asks "has an utlägg" of the database on a one-to-one relation.
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

/** How many purchases the export named no card on, for bookkeeping to place. */
export async function countCardlessTransactions({
  during,
}: { during?: During } = {}): Promise<number> {
  return prisma.bankTransaction.count({
    where: { cardId: null, ...(during ? { transactionDate: during } : {}) },
  });
}

export async function countUnaccountedPurchases(
  holderId: string,
  { during, resultUnitNames }: { during?: During; resultUnitNames?: readonly string[] } = {},
): Promise<number> {
  return prisma.bankTransaction.count({
    where: {
      card: {
        holderId,
        ...(resultUnitNames ? { resultUnit: { name: { in: [...resultUnitNames] } } } : {}),
      },
      matchedExpense: { is: null },
      ...(during ? { transactionDate: during } : {}),
    },
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
