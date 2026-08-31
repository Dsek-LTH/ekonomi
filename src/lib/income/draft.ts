// Making a day's report by hand, before there is anything on it.
//
// The other way a report comes into being. The ordinary one is a fetch: intakt
// routes each sold product to a verksamhet by its prefix, and every verksamhet
// it routed something to gets a report for the day (lib/income/batch.ts). That
// covers everything except the case the routing cannot see:
//
//   two verksamheter sell all day, neither rings up a single product with its
//   prefix, and the whole day's takings land in one report: the fallback's,
//   Skattmästeriets.
//
// Moving lines out fixes half of it. `moveIncomeLines` creates the destination's
// report when there is none, so the first verksamhet's sales can be lifted
// straight out of the fallback and the second's are what remains. But that only
// works while the fallback's report is one of the two: a day whose takings
// belong to two *other* verksamheter has to become two reports, and the second
// of them exists nowhere until somebody says it should.
//
// So: an empty draft, for a source, a day and a verksamhet. Nothing is invented
// with it. It holds no lines, sums to nothing and cannot be booked (see
// `incomeVoucherBlocker`, which answers "noDistributions") until sales are moved
// onto it. It is a place to put them, and until they are put there it is
// deletable and the next fetch sweeps it away like any other draft.
import "server-only";

import { prisma } from "@/lib/server/db";
import type { IncomeSource } from "@/lib/domain/types";

/**
 * The source a report may be created for.
 *
 * Not ZETTLE_FEE: Zettle's own fees are nobody's takings, have no verksamhet
 * and are never split. The fee report for a day is the fee report for that
 * day. `moveIncomeLines` refuses them for the same reason.
 */
export type DraftSource = Extract<IncomeSource, "ZETTLE" | "SWISH">;

export type DraftFailure =
  /** Nothing has ever been fetched, so there is no working set to split. */
  | { reason: "noBatch" }
  /** The unit takes no money in: no key, no voucher text, no PDF. */
  | { reason: "moveUnitNoIncome" }
  /** The day is already booked for this verksamhet, a second could never be. */
  | { reason: "moveDestinationBooked" };

export interface DraftOutcome {
  ok: true;
  id: string;
  /**
   * False when the verksamhet already had a draft for the day and this returned
   * that one instead of making a second.
   *
   * Two drafts for one source, verksamhet and day are two reports of which only
   * one could ever be booked. The partial unique index over booked reports
   * (IncomeReport_booked_once) is exactly that rule, so the second would be a
   * trap set at the moment of creation. Handing back the existing one is also
   * what someone asking for it wants: a place to drop these sales, which is what
   * that report already is.
   */
  created: boolean;
}

export type DraftResult = DraftOutcome | ({ ok: false } & DraftFailure);

export interface CreateDraftInput {
  source: DraftSource;
  /** ISO date, the day that was sold. */
  date: string;
  resultUnitId: string;
}

/**
 * An empty draft report for a verksamhet's day, or the one it already has.
 *
 * The batch is the fetch on the table. A report has to belong to one. It is
 * where the day came from, and a hand-made one came from the same place the
 * sales it is about to hold came from: whatever was last fetched. That is not a
 * guess. A fetch clears every unbooked report before storing what it brought
 * back (see `createSalesBatch`), so every draft in the queue belongs to the
 * newest batch, and attaching this one to it is what makes the next fetch sweep
 * it away with the rest rather than leaving an empty day behind for ever.
 */
export async function createDraftReport(input: CreateDraftInput): Promise<DraftResult> {
  const date = new Date(`${input.date}T00:00:00.000Z`);

  const [batch, income] = await Promise.all([
    prisma.incomeBatch.findFirst({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true },
    }),
    // The destination is a verksamhet, and a verksamhet is a result unit with
    // income settings, the same test a move applies to where it is sending
    // lines, for the same reason: without them there is no key to file the
    // report under and no text for its voucher.
    prisma.resultUnitIncome.findUnique({
      where: { resultUnitId: input.resultUnitId },
      select: { active: true, defaultCostCenterId: true },
    }),
  ]);
  if (!batch) return { ok: false, reason: "noBatch" };
  if (!income?.active) return { ok: false, reason: "moveUnitNoIncome" };

  return prisma.$transaction(async (tx) => {
    // Every report this verksamhet has for the source and the day. There can be
    // a booked one and a draft imported after it. See `moveIncomeLines`, which
    // reads the same set for the same reason.
    const siblings = await tx.incomeReport.findMany({
      where: { source: input.source, resultUnitId: input.resultUnitId, date },
      select: { id: true, status: true },
    });
    const draft = siblings.find((r) => r.status === "DRAFT");
    if (draft) return { ok: true as const, id: draft.id, created: false };
    if (siblings.length > 0) return { ok: false as const, reason: "moveDestinationBooked" as const };

    const created = await tx.incomeReport.create({
      select: { id: true },
      data: {
        batchId: batch.id,
        source: input.source,
        resultUnitId: input.resultUnitId,
        date,
        // Both of these follow the lines, and there are none yet. The total is
        // kept in step by every move (lib/income/lines.ts); the cost centre is
        // the unit's default, pre-filled here exactly as the import pre-fills
        // it, and editable in review.
        total: 0,
        costCenterId: income.defaultCostCenterId,
        // Deliberately not set: `duplicateOf` and `existingVoucher` are findings
        // of an import: this day, for this verksamhet, was already booked, and
        // nothing has been imported here. A day already booked in this database
        // was refused above; one that exists only in Fortnox is caught the same
        // way it is for a report a move created, which is to say at export.
      },
    });

    return { ok: true as const, id: created.id, created: true };
  });
}
