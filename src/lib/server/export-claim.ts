// Taking, moving on and letting go of an utlägg's export lock. Its identity is `exportClaimedAt` to the
// millisecond: every write after the first is conditional on that exact value, so an export whose lock was
// taken over finds out at its next step. lib/domain/export-claim.ts decides what a lock means.
import "server-only";

import type { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { fail } from "@/lib/api/guard";
import { exportLock, type ExportLockView } from "@/lib/domain/export-claim";
import type { ExpenseStatus, ExportClaimState } from "@/lib/domain/types";

/** A lock this export holds. Pass it to every later step. */
export type ExportClaim = { expenseId: string; token: Date };

type Taken = { ok: true; claim: ExportClaim } | { ok: false; res: NextResponse };

/**
 * Take the lock for exporting `expenseId`, or say why not. Read and written in one transaction with the row
 * held (FOR UPDATE); the Fortnox calls happen after it commits.
 */
export function claimExport(expenseId: string, userId: string): Promise<Taken> {
  return prisma.$transaction(async (tx): Promise<Taken> => {
    const [row] = await tx.$queryRaw<
      {
        status: ExpenseStatus;
        exportClaimState: ExportClaimState | null;
        exportClaimedAt: Date | null;
        claimer: string | null;
      }[]
    >`
      SELECT e."status", e."exportClaimState", e."exportClaimedAt", u."name" AS "claimer"
      FROM "Expense" e LEFT JOIN "User" u ON u."id" = e."exportClaimedById"
      WHERE e."id" = ${expenseId}
      FOR UPDATE OF e`;

    if (!row) return { ok: false, res: fail(404, "expense.notFound") };
    if (row.status !== "BOOKED") {
      return {
        ok: false,
        res: fail(409, "expense.exportOnlyBooked", {
          values: { status: { key: `common.status.${row.status}` } },
        }),
      };
    }

    const lock = exportLock(row.exportClaimState, row.exportClaimedAt, Date.now());
    const name = row.claimer ?? "-";
    if (lock === "exporting") {
      return { ok: false, res: fail(409, "expense.exportInProgress", { values: { name } }) };
    }
    if (lock === "uncertain") {
      return { ok: false, res: fail(409, "expense.exportUncertain", { values: { name } }) };
    }
    if (row.exportClaimState) {
      // Free only because it was abandoned before anything was sent, so taken over (CLAIM_ABANDONED_MS).
      console.warn(
        `[export] ${expenseId}: taking over a lock abandoned at ${row.exportClaimedAt?.toISOString()}`,
      );
    }

    const token = new Date();
    await tx.expense.update({
      where: { id: expenseId },
      data: {
        exportClaimedById: userId,
        exportClaimedAt: token,
        exportClaimState: "CLAIMED",
      },
    });
    return { ok: true, claim: { expenseId, token } };
  });
}

/** Say, and commit, before asking Fortnox for the voucher that it is about to be asked. False when the lock is no longer ours: send nothing. */
export async function markSent({ expenseId, token }: ExportClaim): Promise<boolean> {
  const { count } = await prisma.expense.updateMany({
    where: { id: expenseId, exportClaimedAt: token, exportClaimState: "CLAIMED" },
    data: { exportClaimState: "SENT" },
  });
  return count === 1;
}

/** The voucher request came back with no clear answer. Kept, and flagged. */
export async function markUncertain({ expenseId, token }: ExportClaim): Promise<void> {
  await prisma.expense.updateMany({
    where: { id: expenseId, exportClaimedAt: token },
    data: { exportClaimState: "UNCERTAIN" },
  });
}

/** Let go of the lock because no voucher was made. Only this export's own lock. */
export async function releaseExport({ expenseId, token }: ExportClaim): Promise<void> {
  await prisma.expense.updateMany({
    where: { id: expenseId, exportClaimedAt: token },
    data: CLEARED,
  });
}

/** The three columns with no lock in them. */
export const CLEARED = {
  exportClaimedById: null,
  exportClaimedAt: null,
  exportClaimState: null,
} as const;

/** Every utlägg with an export lock that means something now, for the Bokföring list. Lapsed locks are left out; the reader's own are included. */
export async function activeExports(): Promise<Record<string, ExportLockView>> {
  const rows = await prisma.expense.findMany({
    where: { exportClaimState: { not: null } },
    select: {
      id: true,
      exportClaimState: true,
      exportClaimedAt: true,
      exportClaimedBy: { select: { id: true, name: true } },
    },
  });
  const now = Date.now();
  const byExpense: Record<string, ExportLockView> = {};
  for (const r of rows) {
    const lock = exportLock(r.exportClaimState, r.exportClaimedAt, now);
    if (lock !== "free") byExpense[r.id] = { lock, by: r.exportClaimedBy };
  }
  return byExpense;
}
