// The one correction a fetched day's sold lines take: where they book (verksamhet, account, cost
// centre). What the till rang up is not editable. Voucher and document derive from the lines.
// Lines never leave their day. Drafts only.

import "server-only";

import { prisma } from "@/lib/server/db";
import { bulkTransaction } from "@/lib/server/tx";
import type { IncomeReportStatus } from "@/lib/domain/types";

/** Why a change was refused. Each is a message key under `errors.income`. */
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

/** The cost centre a verksamhet's routing gives a sale on `account`: its prefixes' agreed one, else its default (as a fetch would have given, lib/income/config.ts). */
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
      // A new verksamhet brings its own cost centre unless one was named.
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
            // Denormalised, as everywhere a booked document names an account.
            accountName: accountName.get(change.account) ?? "",
          }),
          ...(costCenterId !== undefined && { costCenterId }),
          // Placed by a person, so no longer the routing's leftover.
          ...((change.resultUnitId || change.account) && { unmatched: false }),
        },
      });
    }
    // Written to move `updatedAt`, which the review screen puts in the document's address so the browser refetches the PDF.
    await tx.incomeReport.update({ where: { id: reportId }, data: { updatedAt: new Date() } });
  });

  return { ok: true, updated: changes.length };
}
