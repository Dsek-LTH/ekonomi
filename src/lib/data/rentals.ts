// The rentals list, as the uthyrningsansvarig reads it.
//
// A second list over the same Contract rows the archive reads, not a second
// table. That is how this app already works: /expenses, /approvals and
// /card-purchases are three purpose-built lists over one set of utlägg, because
// what a list is *for* decides its columns and its order, and neither of those
// is a property of the row.
//
// What differs from lib/data/contracts.ts is the whole point of the page. The
// archive answers "which agreements do we have", ordered by when they were
// filed. This answers "where is the gear", ordered by what needs doing.
import "server-only";

import { prisma } from "@/lib/server/db";
import { Prisma } from "@/lib/generated/prisma/client";
import { pageBounds, type ListQuery, type RowPage } from "@/lib/data/list-query";
import {
  RENTAL_TAB,
  rentalState,
  type RentalState,
} from "@/lib/contract/rental-state";
import type { ContractStatus } from "@/lib/domain/types";

export interface RentalRow {
  id: string;
  title: string;
  counterparty: string;
  /** ISO days. */
  pickupAt: string;
  returnAt: string;
  returnedAt: string | null;
  checkedAt: string | null;
  /** Derived against the page's one `today`, so every row is judged on the
   *  same day. */
  state: RentalState;
  priceOre: number;
  /** How many things are on the contract, for the one-line summary. */
  lineCount: number;
  /** Whether the drawn document is in the archive yet. */
  hasDocument: boolean;
}

/**
 * One page of rentals.
 *
 * The state filter is applied in memory, after the query, and that is a
 * deliberate trade. `rentalState` is derived from four columns and today's
 * date, so it cannot be a `where` clause without reimplementing the rule in
 * SQL, and a rule written twice is a rule that will disagree with itself. A
 * section has hundreds of rentals rather than millions, so reading the matching
 * contracts and filtering them here costs nothing and keeps one definition of
 * "overdue".
 *
 * Revisit if that stops being true. The fix is a generated column, not a second
 * copy of the rule.
 */
export async function getRentalPage(q: ListQuery, today: string): Promise<RowPage<RentalRow>> {
  const and: Prisma.ContractWhereInput[] = [{ kind: "RENTAL" }, { rental: { isNot: null } }];

  if (q.q) {
    and.push({
      OR: [
        { title: { contains: q.q, mode: "insensitive" } },
        { counterparty: { contains: q.q, mode: "insensitive" } },
        { rental: { lines: { some: { description: { contains: q.q, mode: "insensitive" } } } } },
      ],
    });
  }

  const rows = await prisma.contract.findMany({
    where: { AND: and },
    // By when the gear is due, soonest first. The archive orders by when a
    // contract was filed, which is the right order for filing and the wrong one
    // for a store room: what matters here is what comes back next.
    orderBy: [{ rental: { returnAt: "asc" } }, { id: "asc" }],
    select: {
      id: true,
      title: true,
      counterparty: true,
      status: true,
      rental: {
        select: {
          pickupAt: true,
          returnAt: true,
          returnedAt: true,
          checkedAt: true,
          priceOre: true,
          _count: { select: { lines: true } },
        },
      },
      _count: { select: { files: true } },
    },
  });

  const all: RentalRow[] = rows
    // `rental` is non-null by the where clause above; this narrows it for the
    // compiler rather than asserting it.
    .filter((c): c is typeof c & { rental: NonNullable<typeof c.rental> } => c.rental !== null)
    .map((c) => {
      const facts = {
        status: c.status as ContractStatus,
        pickupAt: day(c.rental.pickupAt),
        returnAt: day(c.rental.returnAt),
        returnedAt: c.rental.returnedAt ? day(c.rental.returnedAt) : null,
        checkedAt: c.rental.checkedAt ? day(c.rental.checkedAt) : null,
      };
      return {
        id: c.id,
        title: c.title,
        counterparty: c.counterparty,
        ...facts,
        state: rentalState(facts, today),
        priceOre: c.rental.priceOre,
        lineCount: c.rental._count.lines,
        hasDocument: c._count.files > 0,
      };
    });

  const wanted = RENTAL_TAB[q.tab];
  const matching = wanted ? all.filter((r) => wanted.includes(r.state)) : all;

  const { skip, take } = pageBounds(q);
  return { rows: matching.slice(skip, skip + take), total: matching.length };
}

/**
 * The counts behind the tabs, so "Att göra (3)" is answerable without opening
 * it.
 *
 * Cheap because it reads the same small set the list does. Shares the derived
 * rule rather than counting in SQL, for the reason above.
 */
export async function getRentalStateCounts(today: string): Promise<Record<RentalState, number>> {
  const rows = await prisma.rentalDetails.findMany({
    select: {
      pickupAt: true,
      returnAt: true,
      returnedAt: true,
      checkedAt: true,
      contract: { select: { status: true } },
    },
  });

  const counts = {
    UPCOMING: 0,
    OUT: 0,
    OVERDUE: 0,
    AWAITING_CHECK: 0,
    CLOSED: 0,
    CANCELLED: 0,
  } satisfies Record<RentalState, number>;

  for (const r of rows) {
    const state = rentalState(
      {
        status: r.contract.status,
        pickupAt: day(r.pickupAt),
        returnAt: day(r.returnAt),
        returnedAt: r.returnedAt ? day(r.returnedAt) : null,
        checkedAt: r.checkedAt ? day(r.checkedAt) : null,
      },
      today,
    );
    counts[state] += 1;
  }
  return counts;
}

const day = (d: Date): string => d.toISOString().slice(0, 10);
