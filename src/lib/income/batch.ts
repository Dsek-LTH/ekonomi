// Storing what the intakt service returned.
//
// This is where pending.yaml used to be. The old flow wrote a manifest file
// that the treasurer edited by hand — filling in cost centres, deleting lines
// to skip — and then `upload` booked whatever was left. The same three steps
// happen here, except the middle one is a screen and the state survives a
// reload.
import "server-only";

import { prisma } from "@/lib/server/db";
import type { IncomeSource } from "@/lib/domain/types";
import { incomeVoucherKey, type FortnoxIncomeVouchers } from "./duplicate";
import type { IncomeFeeReportDto, IncomeReportDto } from "./types";
import { incomeVoucherDescription } from "./voucher";

export interface CreateBatchResult {
  batchId: string;
  created: number;
  /** The reports that were stored. */
  reportIds: string[];
  /**
   * Unbooked reports the fetch cleared out before storing what it brought back.
   *
   * A fetch is a fresh start: what is waiting to be booked is exactly what came
   * back from it, and nothing else. Re-fetching after correcting a product
   * prefix is the case that matters — the wrongly routed reports have to go,
   * including days the corrected routing no longer produces at all, which any
   * day-by-day replacement would have left behind.
   *
   * Only unbooked ones. A booked day is the section's record of money it took
   * in; nothing about fetching may touch it.
   */
  superseded: number;
  /**
   * Days imported with a warning because this database has already booked them.
   * Not an error — re-fetching a period that is partly done is ordinary — and
   * worth saying out loud, because they are the rows that cannot be booked.
   */
  alreadyBooked: string[];
  /**
   * Days imported with a warning: Fortnox already holds a voucher for that
   * verksamhet on that day — an export from an older install, or from the CLI
   * this replaced. They come in like any other and are flagged, because the
   * section may genuinely have two and that is the reviewer's call, not the
   * importer's.
   */
  alreadyInFortnox: string[];
}

interface CommonInput {
  source: IncomeSource;
  from: string;
  to: string;
  filename?: string | null;
  createdById: string;
}

/**
 * The voucher Fortnox already holds for this verksamhet on this day, if any.
 *
 * Null whenever the check did not run, and deliberately so: the caller is told
 * separately that it did not (see the routes), and a report flagged on the
 * strength of a check that never happened would be a warning nobody could act
 * on.
 */
function existingFortnoxVoucher(
  existing: FortnoxIncomeVouchers | undefined,
  date: Date,
  description: string,
): string | null {
  if (!existing?.checked) return null;
  return existing.byKey.get(incomeVoucherKey(date.toISOString().slice(0, 10), description)) ?? null;
}

/**
 * What a fetch has to reckon with: what is already booked, and what it sweeps
 * aside.
 *
 * `booked` — days already booked or exported for this source, keyed by unit and
 * day, mapped to the report that holds them. The fetch brings these days back
 * anyway and points each one at its predecessor: a day missing from the queue
 * cannot be told apart from a day the fetch never covered, and that ambiguity
 * is worse than a row you have to look at. Booking one is refused — by the
 * screen, and by a partial unique index over booked reports underneath it.
 *
 * `unbookedIds` — every report waiting to be booked, from any source and any
 * period. All of them go: the working set is the last fetch and nothing else.
 */
async function existingReports(
  source: IncomeSource,
): Promise<{ booked: Map<string, string>; unbookedIds: string[] }> {
  const rows = await prisma.incomeReport.findMany({
    select: { id: true, source: true, resultUnitId: true, date: true, status: true },
  });

  const booked = new Map<string, string>();
  const unbookedIds: string[] = [];
  for (const row of rows) {
    if (row.status === "DRAFT") unbookedIds.push(row.id);
    else if (row.source === source) booked.set(dayKey(row.resultUnitId, row.date), row.id);
  }
  return { booked, unbookedIds };
}

const dayKey = (resultUnitId: string | null, date: Date) =>
  `${resultUnitId ?? ""}|${date.toISOString().slice(0, 10)}`;

/**
 * Store a fetch of sales reports as a batch of drafts.
 *
 * Verksamheter are resolved by income key. A report naming one the app does not
 * have is dropped rather than imported unit-less: the service was sent this
 * app's routing table, so it can only name a key that was in it, and a mismatch
 * means the two have drifted in a way that wants looking at rather than
 * papering over.
 */
export async function createSalesBatch(
  input: CommonInput,
  reports: readonly IncomeReportDto[],
  /** What Fortnox already has for this range, when it could be asked. */
  existing?: FortnoxIncomeVouchers,
): Promise<CreateBatchResult> {
  // Keyed by the income key, resolved to the RESULT UNIT the report belongs to
  // — a report records whose takings these were, and that outlives any decision
  // to stop selling (see the schema note on IncomeReport.resultUnitId).
  const units = await prisma.resultUnitIncome.findMany({
    // The description is what the voucher is called, and therefore how a day
    // is recognised in Fortnox — see incomeVoucherDescription.
    select: { key: true, description: true, defaultCostCenterId: true, resultUnitId: true },
  });
  const idByKey = new Map(units.map((u) => [u.key, u.resultUnitId]));
  const descriptionByKey = new Map(units.map((u) => [u.key, u.description]));
  // Pre-filled here, then editable in review — the field the manifest existed
  // to let someone type. A verksamhet with no default leaves it blank, and
  // booking falls back to it rather than refusing.
  const defaultCostCentreByKey = new Map(units.map((u) => [u.key, u.defaultCostCenterId]));

  const accounts = await prisma.account.findMany({ select: { number: true, name: true } });
  const accountName = new Map(accounts.map((a) => [a.number, a.name]));

  const usable = reports.filter((r) => idByKey.has(r.committee));

  const resolved = usable.map((r) => ({
    report: r,
    resultUnitId: idByKey.get(r.committee)!,
    date: new Date(`${r.date}T00:00:00.000Z`),
  }));

  const already = await existingReports(input.source);

  const bookedHere = ({ resultUnitId, date }: (typeof resolved)[number]) =>
    already.booked.get(dayKey(resultUnitId, date)) ?? null;
  const inFortnox = ({ report, date }: (typeof resolved)[number]) =>
    existingFortnoxVoucher(
      existing,
      date,
      incomeVoucherDescription(input.source, descriptionByKey.get(report.committee) ?? null),
    );

  // Everything the fetch returned, without exception. What is already booked
  // here, or already in Fortnox, is imported carrying a pointer to it — see
  // `existingReports`.
  const fresh = resolved;
  const alreadyBooked = resolved.filter(bookedHere).map(({ report }) => report.key);
  const alreadyInFortnox = resolved.filter(inFortnox).map(({ report }) => report.key);

  // Everything that was waiting before this fetch — see `superseded`.
  const stale = already.unbookedIds;

  // One transaction: a half-written batch is worse than none, because the part
  // that landed looks like a complete import of a narrower range.
  const batch = await prisma.$transaction(async (tx) => {
    const created = await tx.incomeBatch.create({
      data: {
        source: input.source,
        fromDate: new Date(`${input.from}T00:00:00.000Z`),
        toDate: new Date(`${input.to}T00:00:00.000Z`),
        filename: input.filename ?? null,
        createdById: input.createdById,
      },
    });

    // Inside the transaction, and before the new ones: if this import fails
    // half way, what it was clearing is still there.
    if (stale.length > 0) await tx.incomeReport.deleteMany({ where: { id: { in: stale } } });

    const reportIds: string[] = [];
    for (const { report, resultUnitId, date } of fresh) {
      const row = await tx.incomeReport.create({
        select: { id: true },
        data: {
          batchId: created.id,
          source: input.source,
          resultUnitId,
          date,
          total: report.total,
          costCenterId: defaultCostCentreByKey.get(report.committee) ?? null,
          duplicateOfId: bookedHere({ report, resultUnitId, date }),
          existingVoucher: inFortnox({ report, resultUnitId, date }),
          lines: {
            create: report.products.map((p, i) => ({
              name: p.name,
              variant: p.variant ?? null,
              account: p.account,
              accountName: accountName.get(p.account) ?? "",
              quantity: p.quantity,
              unitPrice: p.unitPrice,
              discount: p.effectiveDiscount,
              total: p.total,
              sortOrder: i,
            })),
          },
        },
      });
      reportIds.push(row.id);
    }

    return { batch: created, reportIds };
  });

  return {
    batchId: batch.batch.id,
    created: fresh.length,
    reportIds: batch.reportIds,
    superseded: stale.length,
    alreadyBooked,
    alreadyInFortnox,
  };
}

/**
 * The same for Zettle's fees, which are not attributable to a committee — one
 * report per day, and the cost centre comes from BookkeepingSettings rather
 * than from a committee that does not exist.
 */
export async function createFeeBatch(
  input: CommonInput,
  reports: readonly IncomeFeeReportDto[],
  existing?: FortnoxIncomeVouchers,
): Promise<CreateBatchResult> {
  const settings = await prisma.bookkeepingSettings.findUnique({ where: { id: "singleton" } });
  const costCenterId = settings?.zettleFeeCostCenterId ?? null;
  const feeAccount = settings?.zettleFeeAccount ?? "6570";
  const account = await prisma.account.findUnique({ where: { number: feeAccount } });

  const resolved = reports.map((r) => ({ report: r, date: new Date(`${r.date}T00:00:00.000Z`) }));

  const already = await existingReports(input.source);

  // Every day of fees carries the same text, so the date is what tells two
  // apart — which is exactly what the key is.
  const feeDescription = incomeVoucherDescription(input.source, null);
  const bookedHere = (date: Date) => already.booked.get(dayKey(null, date)) ?? null;
  const inFortnox = (date: Date) => existingFortnoxVoucher(existing, date, feeDescription);

  const fresh = resolved;
  const alreadyBooked = resolved
    .filter(({ date }) => bookedHere(date))
    .map(({ report }) => report.key);
  const alreadyInFortnox = resolved
    .filter(({ date }) => inFortnox(date))
    .map(({ report }) => report.key);
  const stale = already.unbookedIds;

  const batch = await prisma.$transaction(async (tx) => {
    const created = await tx.incomeBatch.create({
      data: {
        source: input.source,
        fromDate: new Date(`${input.from}T00:00:00.000Z`),
        toDate: new Date(`${input.to}T00:00:00.000Z`),
        createdById: input.createdById,
      },
    });

    // Replaced, not duplicated — see createSalesBatch.
    if (stale.length > 0) await tx.incomeReport.deleteMany({ where: { id: { in: stale } } });

    const reportIds: string[] = [];
    for (const { report, date } of fresh) {
      const row = await tx.incomeReport.create({
        select: { id: true },
        data: {
          batchId: created.id,
          source: input.source,
          resultUnitId: null,
          costCenterId,
          date,
          total: report.total,
          duplicateOfId: bookedHere(date),
          existingVoucher: inFortnox(date),
          lines: {
            create: report.fees.map((f, i) => ({
              name: f.name,
              account: f.account,
              accountName: account?.name ?? "",
              quantity: f.quantity,
              unitPrice: f.unitPrice,
              discount: 0,
              total: f.total,
              sortOrder: i,
            })),
          },
        },
      });
      reportIds.push(row.id);
    }

    return { batch: created, reportIds };
  });

  return {
    batchId: batch.batch.id,
    created: fresh.length,
    reportIds: batch.reportIds,
    superseded: stale.length,
    alreadyBooked,
    alreadyInFortnox,
  };
}
