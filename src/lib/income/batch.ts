// Storing a fetch: what Zettle or a Swish export said was sold, routed into days.

import "server-only";

import type { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/server/db";
import type { IncomeSource } from "@/lib/domain/types";
import type { FortnoxIncomeVouchers } from "./duplicate";
import type { IncomeDayDto } from "./types";
import { isoDay } from "@/lib/domain/date";

interface CreateBatchResult {
  batchId: string;
  created: number;
  /** The reports that were stored. */
  reportIds: string[];
  /** Unbooked reports of this source the fetch cleared before storing. A fetch restarts its own source's drafts only, never booked days. */
  superseded: number;
  /** Days imported with a warning because this database has already booked them. */
  alreadyBooked: string[];
  /** Days imported with a warning: Fortnox already holds a voucher for some of that day's money. */
  alreadyInFortnox: string[];
}

interface BatchInput {
  source: Extract<IncomeSource, "ZETTLE" | "SWISH">;
  from: string;
  to: string;
  filename?: string | null;
  createdById: string;
}

/**
 * What a fetch reckons with for its source. `booked`: day to a booked report holding some of that
 * day's money (any kind, since booking again would double count). The day is still imported,
 * pointing at it, and booking is refused.
 */
async function existingReports(
  source: BatchInput["source"],
): Promise<{ booked: Map<string, string>; unbookedIds: string[] }> {
  const sources: IncomeSource[] = source === "ZETTLE" ? ["ZETTLE", "ZETTLE_FEE"] : [source];
  const rows = await prisma.incomeReport.findMany({
    where: { source: { in: sources } },
    select: { id: true, source: true, date: true, status: true },
    orderBy: { createdAt: "asc" },
  });

  const booked = new Map<string, string>();
  const unbookedIds: string[] = [];
  for (const row of rows) {
    if (row.status === "DRAFT") {
      if (row.source === source) unbookedIds.push(row.id);
    } else if (!booked.has(isoDay(row.date))) {
      booked.set(isoDay(row.date), row.id);
    }
  }
  return { booked, unbookedIds };
}

/**
 * Store a fetch as one draft report per day. A line naming an unknown income key is kept unmatched
 * (no verksamhet) rather than dropped, so the total holds and the day cannot be booked until placed.
 */
export async function createDayBatch(
  input: BatchInput,
  days: readonly IncomeDayDto[],
  /** What Fortnox already has for this range, when it could be asked. */
  existing?: FortnoxIncomeVouchers,
): Promise<CreateBatchResult> {
  const [units, accounts] = await Promise.all([
    prisma.resultUnitIncome.findMany({ select: { key: true, resultUnitId: true } }),
    prisma.account.findMany({ select: { number: true, name: true } }),
  ]);
  const unitByKey = new Map(units.map((u) => [u.key, u.resultUnitId]));
  const accountName = new Map(accounts.map((a) => [a.number, a.name]));

  const already = await existingReports(input.source);
  const inFortnox = (date: string) =>
    existing?.checked ? (existing.forDay(date, input.source) ?? null) : null;

  const alreadyBooked = days.filter((d) => already.booked.has(d.date)).map((d) => d.date);
  const alreadyInFortnox = days.filter((d) => inFortnox(d.date)).map((d) => d.date);
  const stale = already.unbookedIds;

  // One transaction: a half-written batch looks like a complete import of a narrower range.
  const batch = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const created = await tx.incomeBatch.create({
      data: {
        source: input.source,
        fromDate: new Date(`${input.from}T00:00:00.000Z`),
        toDate: new Date(`${input.to}T00:00:00.000Z`),
        filename: input.filename ?? null,
        createdById: input.createdById,
      },
    });
    // Before the new ones, so a failed import leaves what it was clearing.
    if (stale.length > 0) await tx.incomeReport.deleteMany({ where: { id: { in: stale } } });

    const reportIds: string[] = [];
    for (const day of days) {
      const row = await tx.incomeReport.create({
        select: { id: true },
        data: {
          batchId: created.id,
          source: input.source,
          date: new Date(`${day.date}T00:00:00.000Z`),
          total: day.total,
          duplicateOfId: already.booked.get(day.date) ?? null,
          existingVoucher: inFortnox(day.date),
          lines: {
            create: day.lines.map((l, i) => {
              const resultUnitId = l.unitKey ? (unitByKey.get(l.unitKey) ?? null) : null;
              return {
                kind: l.kind,
                resultUnitId,
                costCenterId: l.costCenterId,
                unmatched: l.unmatched || (l.kind === "SALE" && !resultUnitId),
                name: l.name,
                variant: l.variant ?? null,
                account: l.account,
                accountName: accountName.get(l.account) ?? "",
                quantity: l.quantity,
                unitPrice: l.unitPrice,
                discount: l.effectiveDiscount,
                total: l.total,
                sortOrder: i,
              };
            }),
          },
        },
      });
      reportIds.push(row.id);
    }

    return { batch: created, reportIds };
  });

  return {
    batchId: batch.batch.id,
    created: days.length,
    reportIds: batch.reportIds,
    superseded: stale.length,
    alreadyBooked,
    alreadyInFortnox,
  };
}
