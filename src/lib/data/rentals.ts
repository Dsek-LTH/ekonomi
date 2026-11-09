import "server-only";

import { prisma } from "@/lib/server/db";
import { Prisma } from "@/lib/generated/prisma/client";
import { pageBounds, type ListQuery, type RowPage } from "@/lib/data/list-query";
import { RENTAL_TAB, rentalState, type RentalState } from "@/lib/contract/rental-state";
import { isoDay } from "@/lib/domain/date";

export interface RentalRow {
  id: string;
  title: string;
  counterparty: string;
  pickupAt: string;
  returnAt: string;
  returnedAt: string | null;
  checkedAt: string | null;
  /** Judged against the page's single `today`. */
  state: RentalState;
  priceOre: number;
  lineCount: number;
  hasDocument: boolean;
}

/**
 * One page of rentals. The state filter runs in memory: `rentalState` is derived from four columns
 * and today, and writing it again in SQL would let the two rules disagree.
 */
export async function getRentalPage(q: ListQuery, today: string): Promise<RowPage<RentalRow>> {
  const and: Prisma.ContractWhereInput[] = [{ rental: { isNot: null } }];

  if (q.q) {
    and.push({
      OR: [
        { title: { contains: q.q, mode: "insensitive" } },
        { agreement: { counterparty: { contains: q.q, mode: "insensitive" } } },
        {
          rental: {
            lines: { some: { description: { contains: q.q, mode: "insensitive" } } },
          },
        },
      ],
    });
  }

  const rows = await prisma.contract.findMany({
    where: { AND: and },
    // By when the gear is due, soonest first (the archive orders by filing date).
    orderBy: [{ rental: { returnAt: "asc" } }, { id: "asc" }],
    select: {
      id: true,
      title: true,
      agreement: { select: { counterparty: true } },
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
    // `rental` is non-null by the where clause; this narrows it for the compiler.
    .filter((c): c is typeof c & { rental: NonNullable<typeof c.rental> } => c.rental !== null)
    .map((c) => {
      const facts = {
        pickupAt: isoDay(c.rental.pickupAt),
        returnAt: isoDay(c.rental.returnAt),
        returnedAt: c.rental.returnedAt ? isoDay(c.rental.returnedAt) : null,
        checkedAt: c.rental.checkedAt ? isoDay(c.rental.checkedAt) : null,
      };
      return {
        id: c.id,
        title: c.title,
        // A rental always has an agreement naming its renter; see CreateRental.
        counterparty: c.agreement!.counterparty!,
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

/** The counts behind the tabs. Shares the derived rule rather than counting in SQL. */
export async function getRentalStateCounts(today: string): Promise<Record<RentalState, number>> {
  const rows = await prisma.rentalDetails.findMany({
    select: {
      pickupAt: true,
      returnAt: true,
      returnedAt: true,
      checkedAt: true,
    },
  });

  const counts = {
    UPCOMING: 0,
    OUT: 0,
    OVERDUE: 0,
    AWAITING_CHECK: 0,
    CLOSED: 0,
  } satisfies Record<RentalState, number>;

  for (const r of rows) {
    const state = rentalState(
      {
        pickupAt: isoDay(r.pickupAt),
        returnAt: isoDay(r.returnAt),
        returnedAt: r.returnedAt ? isoDay(r.returnedAt) : null,
        checkedAt: r.checkedAt ? isoDay(r.checkedAt) : null,
      },
      today,
    );
    counts[state] += 1;
  }
  return counts;
}
