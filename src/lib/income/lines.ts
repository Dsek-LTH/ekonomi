// The one correction a fetched day's sold lines take: where they book.
//
// Whose sale a line was, which account it is credited to, and which cost
// centre it books against. All three are this app's own routing, and routing
// is what a product rung up without its prefix, or with the wrong one, gets
// wrong. What the till rang up (the product, how many, for how much) is not
// editable here and never will be.
//
// Everything downstream is derived from the lines, so it follows on its own:
// the voucher is the lines summed per account and cost centre
// (lib/income/voucher.ts), and the intäktsräkning is rendered from them on
// demand while the day is a draft (lib/income/document.ts). There is no
// report-level cost centre to fall out of step with them, and no hand-edited
// voucher to go stale.
//
// Lines never leave their day. A day is one source's takings for one date,
// every verksamhet in it, so a sale that landed in the reserv is corrected by
// giving that line its verksamhet, not by moving it to another report.
//
// Drafts only. A booked day's voucher is in the ledger and its document in
// storage; neither can be re-made.
import "server-only";

import { prisma } from "@/lib/server/db";
import { bulkTransaction } from "@/lib/server/tx";
import type { IncomeReportStatus } from "@/lib/domain/types";

/**
 * Why a change was refused. Each maps to a message key under `errors.income`.
 * They are all states a person can ask for from the review screen, so each one
 * has to be sayable.
 */
export type LineFailure =
  | { reason: "reportNotFound" }
  | { reason: "editOnlyBeforeBooking"; status: IncomeReportStatus }
  | { reason: "noLines" }
  /** A line id that is not on this report: a stale screen, or a bad request. */
  | { reason: "unknownLine" }
  | { reason: "unknownAccount"; account: string }
  | { reason: "unknownCostCenter" }
  /** The verksamhet takes no money in: no income settings, or retired. */
  | { reason: "unitNoIncome" }
  /** Zettle's own fees are nobody's sales, so they have no verksamhet. */
  | { reason: "feeHasNoUnit" };

export interface LineChange {
  id: string;
  resultUnitId?: string;
  account?: string;
  /** Null clears it, which leaves the day unbookable until one is chosen. */
  costCenterId?: string | null;
}

type LineResult = { ok: true; updated: number } | ({ ok: false } & LineFailure);

/** A verksamhet as a line can be given to it: where its sales book. */
interface UnitRouting {
  defaultCostCenterId: string | null;
  prefixes: { account: string; costCenterId: string | null }[];
}

/**
 * The cost centre a verksamhet's routing gives a sale on `account`: the one
 * its prefixes for that account name, if they agree on one, else its default.
 *
 * The same answer a fetch would have given the line had it been rung up with
 * the right prefix (lib/income/config.ts), which is the point: correcting a
 * line should land it exactly where it would have gone.
 */
function routedCostCenter(unit: UnitRouting, account: string): string | null {
  const named = new Set(
    unit.prefixes.filter((p) => p.account === account && p.costCenterId).map((p) => p.costCenterId),
  );
  return named.size === 1 ? [...named][0]! : unit.defaultCostCenterId;
}

export async function updateIncomeLines(
  reportId: string,
  changes: readonly LineChange[],
): Promise<LineResult> {
  if (changes.length === 0) return { ok: false, reason: "noLines" };

  const report = await prisma.incomeReport.findUnique({
    where: { id: reportId },
    select: {
      status: true,
      lines: { select: { id: true, kind: true, account: true, resultUnitId: true } },
    },
  });
  if (!report) return { ok: false, reason: "reportNotFound" };
  if (report.status !== "DRAFT") {
    return { ok: false, reason: "editOnlyBeforeBooking", status: report.status };
  }

  const own = new Map(report.lines.map((l) => [l.id, l]));
  if (changes.some((c) => !own.has(c.id))) return { ok: false, reason: "unknownLine" };
  if (changes.some((c) => c.resultUnitId && own.get(c.id)!.kind === "FEE")) {
    return { ok: false, reason: "feeHasNoUnit" };
  }

  const accounts = [...new Set(changes.flatMap((c) => (c.account ? [c.account] : [])))];
  const known = await prisma.account.findMany({
    where: { number: { in: accounts } },
    select: { number: true, name: true },
  });
  const accountName = new Map(known.map((a) => [a.number, a.name]));
  const missing = accounts.find((a) => !accountName.has(a));
  if (missing) return { ok: false, reason: "unknownAccount", account: missing };

  const centres = [...new Set(changes.flatMap((c) => (c.costCenterId ? [c.costCenterId] : [])))];
  if (centres.length > 0) {
    const found = await prisma.costCenter.count({ where: { id: { in: centres } } });
    if (found !== centres.length) return { ok: false, reason: "unknownCostCenter" };
  }

  const unitIds = [...new Set(changes.flatMap((c) => (c.resultUnitId ? [c.resultUnitId] : [])))];
  const units = await prisma.resultUnitIncome.findMany({
    where: { resultUnitId: { in: unitIds } },
    select: {
      resultUnitId: true,
      active: true,
      defaultCostCenterId: true,
      prefixes: { select: { account: true, costCenterId: true } },
    },
  });
  const unitById = new Map(units.map((u) => [u.resultUnitId, u]));
  if (unitIds.some((id) => !unitById.get(id)?.active)) return { ok: false, reason: "unitNoIncome" };

  await bulkTransaction(async (tx) => {
    for (const change of changes) {
      const line = own.get(change.id)!;
      const account = change.account ?? line.account;
      const unit = change.resultUnitId ? unitById.get(change.resultUnitId)! : null;
      // A new verksamhet brings its own cost centre unless one was named: a
      // sale lifted out of the reserv onto Sexmästeriet's pub account should
      // land on the pub's cost centre, not keep the reserv's.
      const costCenterId =
        change.costCenterId !== undefined
          ? change.costCenterId
          : unit
            ? routedCostCenter(unit, account)
            : undefined;
      await tx.incomeLine.update({
        where: { id: change.id },
        data: {
          ...(change.resultUnitId && { resultUnitId: change.resultUnitId }),
          ...(change.account && {
            account: change.account,
            // Denormalised beside the number, as everywhere a booked document
            // names an account. The chart may be edited, the evidence may not.
            accountName: accountName.get(change.account) ?? "",
          }),
          ...(costCenterId !== undefined && { costCenterId }),
          // Somebody has decided where it goes, so it is no longer the
          // routing's leftover.
          ...((change.resultUnitId || change.account) && { unmatched: false }),
        },
      });
    }
    // The report itself is untouched in substance, since where money books
    // does not change how much of it there is. It is written all the same to
    // move `updatedAt`: that timestamp is what the review screen hangs on the
    // document's address, so the browser fetches the corrected PDF rather than
    // the copy it was told it could keep for five minutes.
    await tx.incomeReport.update({ where: { id: reportId }, data: { updatedAt: new Date() } });
  });

  return { ok: true, updated: changes.length };
}
