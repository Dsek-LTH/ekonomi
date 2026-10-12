// The two corrections a fetched day's sold lines can need: which verksamhet's
// report they belong to, and which account they book to.
//
// Both are about *routing* rather than about amounts. What the till rang up is
// not editable here and never will be. See the note on UpdateIncomeReport,
// but where a sale was routed is this app's own doing, and this app's routing
// is what a prefix typed wrong gets wrong.
//
// Why this exists: a product rung up without its prefix routes to the fallback
// (lib/income/config.ts), which is Skattmästeriet, deliberately, so an
// unrecognised sale lands somewhere visible rather than nowhere. But the money
// was Sexmästeriet's, and their correctly prefixed beer is already sitting in
// their own report for the same day. Without this, the only ways out are to
// book two reports for what is one day's takings, or to correct the routing
// table and re-fetch, which throws away every other correction in flight
// (see createSalesBatch, which clears the unbooked working set).
//
// What a move is, exactly: the IncomeLine rows change report. Nothing is
// recomputed from the till, nothing is invented. Which means the two documents
// follow on their own.
//
//   • the intäktsräkning is rendered from these lines on demand while a report
//     is a draft (lib/income/document.ts), so both PDFs are correct the next
//     time anyone looks;
//   • the verifikation is derived from them too, by summing per account
//     (lib/income/voucher.ts), so the voucher follows the evidence rather than
//     being edited to match it.
//
// The one thing that does not follow is `IncomeReport.total`, which is stored.
// It is recomputed here for both reports, and if it ever were not, booking
// would refuse rather than mis-book: `incomeVoucherBlocker` compares the
// distributions against it and answers "unbalanced".
//
// Drafts only. A booked report's PDF is in object storage and its voucher is in
// Fortnox; neither can be re-made, so neither end of a move may be one.
import "server-only";

import { prisma } from "@/lib/server/db";
import { bulkTransaction } from "@/lib/server/tx";
import type { IncomeReportStatus } from "@/lib/domain/types";

/**
 * Why a move was refused. Each maps to a message key under `errors.income`.
 *
 * They are all states a person can ask for from the review screen, so each one
 * has to be sayable. "That day is already booked over there" is the answer to
 * a reasonable question, not an internal error.
 */
type LineFailure =
  | { reason: "reportNotFound" }
  | { reason: "editOnlyBeforeBooking"; status: IncomeReportStatus }
  | { reason: "noLines" }
  /** A line id that is not on this report, a stale screen, or a bad request. */
  | { reason: "unknownLine" }
  | { reason: "unknownAccount"; account: string };

/** The above, plus what can only go wrong when a destination is involved. */
export type MoveFailure =
  | LineFailure
  /** Zettle's own fees are nobody's takings, so there is no verksamhet to move them to. */
  | { reason: "moveFeeReport" }
  | { reason: "moveSameUnit" }
  /** The destination takes no money in, so it has no key, no voucher text and no PDF. */
  | { reason: "moveUnitNoIncome" }
  | { reason: "moveDestinationBooked" };

interface MoveOutcome {
  ok: true;
  /** Null when the move emptied the source and it was removed. */
  sourceId: string | null;
  destinationId: string;
  /** True when the destination report did not exist until now. */
  destinationCreated: boolean;
  moved: number;
}

type MoveResult = MoveOutcome | ({ ok: false } & MoveFailure);

/** One line to move, and the account it should carry once it has. */
interface MoveLineInput {
  id: string;
  /**
   * Where the money books on the other side. Optional: left out, the line keeps
   * the account the routing gave it.
   *
   * It is a choice rather than something derived because there is nothing left
   * to derive it from. intakt strips the prefix off a product name when it
   * routes (report/helpers.go, `deconstruct`), so a line that ended up in the
   * fallback is one whose name never had a prefix in the first place. There is
   * no evidence in the row of which of the destination's accounts it belongs
   * to. The screen suggests, a person decides.
   */
  account?: string;
}

/** One line, and the account it should book to. */
interface LineAccountInput {
  id: string;
  account: string;
}

type LineAccountResult = { ok: true; updated: number } | ({ ok: false } & LineFailure);

/**
 * Re-account lines in place: same report, different revenue account.
 *
 * The other half of the correction a move makes. A sale that fell to the
 * fallback is usually both in the wrong report *and* on the wrong account, but
 * not always: a verksamhet's own product rung up under the wrong prefix of its
 * own lands in the right report on the wrong account, and dragging it somewhere
 * and back would be an absurd way to fix that. It is also what makes dropping a
 * line onto another day cheap. The account can be put right afterwards, in the
 * table, rather than being decided before anything is allowed to move.
 *
 * Everything downstream follows exactly as it does for a move: the account
 * column of the intäktsräkning, the account distribution it prints, and the
 * credit rows of the verifikation are all derived from these lines.
 */
export async function setLineAccounts(
  reportId: string,
  lines: readonly LineAccountInput[],
): Promise<LineAccountResult> {
  if (lines.length === 0) return { ok: false, reason: "noLines" };

  const report = await prisma.incomeReport.findUnique({
    where: { id: reportId },
    select: { id: true, status: true, lines: { select: { id: true } } },
  });
  if (!report) return { ok: false, reason: "reportNotFound" };
  if (report.status !== "DRAFT") {
    return { ok: false, reason: "editOnlyBeforeBooking", status: report.status };
  }

  const own = new Set(report.lines.map((l) => l.id));
  if (lines.some((l) => !own.has(l.id))) return { ok: false, reason: "unknownLine" };

  const wanted = [...new Set(lines.map((l) => l.account))];
  const known = await prisma.account.findMany({
    where: { number: { in: wanted } },
    select: { number: true, name: true },
  });
  const accountName = new Map(known.map((a) => [a.number, a.name]));
  const missing = wanted.find((a) => !accountName.has(a));
  if (missing) return { ok: false, reason: "unknownAccount", account: missing };

  await bulkTransaction(async (tx) => {
    // Grouped by the account they land on rather than written one at a time.
    // Setting an account is nearly always the same account for every line in a
    // selection, so this is usually a single statement, and a report with a
    // few hundred lines is no longer a few hundred round trips inside one
    // transaction.
    const byAccount = new Map<string, string[]>();
    for (const line of lines) {
      const ids = byAccount.get(line.account);
      if (ids) ids.push(line.id);
      else byAccount.set(line.account, [line.id]);
    }
    for (const [account, ids] of byAccount) {
      await tx.incomeLine.updateMany({
        where: { id: { in: ids } },
        data: { account, accountName: accountName.get(account) ?? "" },
      });
    }
    // The report itself is untouched. An account says where the money books,
    // not how much of it there is, so the total cannot have changed. It is
    // written back all the same, at the value it already holds, purely to move
    // `updatedAt`: that timestamp is what the review screen hangs on the
    // document's URL, and without it the browser would go on showing the
    // five-minute-old PDF with the old account in its distribution table.
    const total = await tx.incomeLine.aggregate({
      where: { reportId },
      _sum: { total: true },
    });
    await tx.incomeReport.update({
      where: { id: reportId },
      data: { total: total._sum.total ?? 0 },
    });
  });

  return { ok: true, updated: lines.length };
}

/**
 * Move `lines` off report `sourceId` and onto the given verksamhet's report for
 * the same source and day, creating that report if it does not exist yet.
 *
 * The whole thing is one transaction: a half-done move would be takings counted
 * twice or not at all, which is the one outcome worse than the mis-routing it
 * is fixing.
 */
export async function moveIncomeLines(
  sourceId: string,
  toResultUnitId: string,
  lines: readonly MoveLineInput[],
): Promise<MoveResult> {
  if (lines.length === 0) return { ok: false, reason: "noLines" };

  const source = await prisma.incomeReport.findUnique({
    where: { id: sourceId },
    select: {
      id: true,
      batchId: true,
      source: true,
      date: true,
      status: true,
      resultUnitId: true,
      lines: { select: { id: true } },
    },
  });
  if (!source) return { ok: false, reason: "reportNotFound" };
  if (source.status !== "DRAFT") {
    return { ok: false, reason: "editOnlyBeforeBooking", status: source.status };
  }
  if (source.source === "ZETTLE_FEE") return { ok: false, reason: "moveFeeReport" };
  if (source.resultUnitId === toResultUnitId) return { ok: false, reason: "moveSameUnit" };

  // Every requested line has to be on this report. Not a formality: the ids
  // come from a screen that may have been open since before someone else moved
  // the same lines, and silently moving whatever still matched would be this
  // route agreeing with a stale view of the day.
  const own = new Set(source.lines.map((l) => l.id));
  if (lines.some((l) => !own.has(l.id))) return { ok: false, reason: "unknownLine" };

  // The destination is a verksamhet, and a verksamhet is a result unit with
  // income settings: the key intakt files the report under, the text its
  // voucher carries and the name on the PDF all live there. A unit without them
  // would produce a report no document could be rendered for.
  const income = await prisma.resultUnitIncome.findUnique({
    where: { resultUnitId: toResultUnitId },
    select: { active: true, defaultCostCenterId: true },
  });
  if (!income?.active) return { ok: false, reason: "moveUnitNoIncome" };

  const accounts = [...new Set(lines.flatMap((l) => (l.account ? [l.account] : [])))];
  const known = await prisma.account.findMany({
    where: { number: { in: accounts } },
    select: { number: true, name: true },
  });
  const accountName = new Map(known.map((a) => [a.number, a.name]));
  const missing = accounts.find((a) => !accountName.has(a));
  if (missing) return { ok: false, reason: "unknownAccount", account: missing };

  // Every report the destination has for this source and day. There can be two
  // A booked one and a draft that was imported after it, pointing at it
  // through `duplicateOf`, so this asks for both rather than the first.
  const siblings = await prisma.incomeReport.findMany({
    where: { source: source.source, resultUnitId: toResultUnitId, date: source.date },
    select: { id: true, status: true },
  });
  const target = siblings.find((r) => r.status === "DRAFT");
  // No draft to move into and the day is already booked over there: creating
  // one would be creating a report that can never be booked, because the
  // partial unique index over booked reports (IncomeReport_booked_once) is
  // exactly this. Say so instead.
  if (!target && siblings.length > 0) return { ok: false, reason: "moveDestinationBooked" };

  return bulkTransaction(async (tx) => {
    let destinationId = target?.id;
    const destinationCreated = !destinationId;

    if (!destinationId) {
      const created = await tx.incomeReport.create({
        select: { id: true },
        data: {
          // The fetch that brought the money in is the fetch this belongs to:
          // the lines are its lines, whichever report they end up under.
          batchId: source.batchId,
          source: source.source,
          resultUnitId: toResultUnitId,
          date: source.date,
          // Filled in from the lines below, like the source's.
          total: 0,
          costCenterId: income.defaultCostCenterId,
          // Deliberately not carried over. `duplicateOf` and `existingVoucher`
          // are findings of the import: this day, for this verksamhet, was
          // already booked, and this is a different verksamhet's day, about
          // which the import found nothing. Booking still checks.
        },
      });
      destinationId = created.id;
    }

    const offset = destinationCreated
      ? 0
      : ((
          await tx.incomeLine.aggregate({
            where: { reportId: destinationId },
            _max: { sortOrder: true },
          })
        )._max.sortOrder ?? -1) + 1;

    // In the order they were given, so lines that were beside each other on one
    // report stay beside each other on the other.
    for (const [i, line] of lines.entries()) {
      await tx.incomeLine.update({
        where: { id: line.id },
        data: {
          reportId: destinationId,
          sortOrder: offset + i,
          ...(line.account && {
            account: line.account,
            // Denormalised beside the number, as everywhere a booked document
            // names an account. The chart may be edited, the evidence may not.
            accountName: accountName.get(line.account) ?? "",
          }),
        },
      });
    }

    // Both ends, from their lines. See the note at the top: this is the one
    // thing a move has to keep in step by hand.
    const sourceTotal = await tx.incomeLine.aggregate({
      where: { reportId: sourceId },
      _sum: { total: true },
      _count: { _all: true },
    });
    const destinationTotal = await tx.incomeLine.aggregate({
      where: { reportId: destinationId },
      _sum: { total: true },
    });

    await tx.incomeReport.update({
      where: { id: destinationId },
      data: { total: destinationTotal._sum.total ?? 0 },
    });

    // A report with nothing left on it is not a day with no takings. It is a
    // day whose takings turned out to be somebody else's. Leaving it would
    // leave an unbookable empty row in the queue for every mis-sale corrected.
    const emptied = sourceTotal._count._all === 0;
    if (emptied) await tx.incomeReport.delete({ where: { id: sourceId } });
    else {
      await tx.incomeReport.update({
        where: { id: sourceId },
        data: { total: sourceTotal._sum.total ?? 0 },
      });
    }

    return {
      ok: true as const,
      sourceId: emptied ? null : sourceId,
      destinationId,
      destinationCreated,
      moved: lines.length,
    };
  });
}
