// Resolve an export that ended without an answer. [id] = expense id.
// A person who has looked in Fortnox says what they found:
//   none     no voucher. The lock is let go, and the utlägg can be exported again.
//   exists   it is there, as series and number. Recorded as a successful export would have been.
// Both are conditional on the very lock that was looked into, so a second simultaneous resolve is a 409.
// EXPORT_UNDO, the same authority as unexporting.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { canUnexport } from "@/lib/domain/permissions";
import { exportLock } from "@/lib/domain/export-claim";
import { fail, gate } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { applied, commit } from "@/lib/api/stale-write";
import { ResolveExport } from "@/lib/api/schemas/expense";
import { CLEARED } from "@/lib/server/export-claim";
import { recordExport } from "@/lib/fortnox/export";
import { deliverSoon, notify } from "@/lib/server/notify";
import { expenseNotice } from "@/lib/email/content";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await gate(canUnexport, "expense.noExportResolveAccess");
  if (!g.ok) return g.res;
  const actorId = g.actor.id;

  const parsed = await parseBody(req, ResolveExport);
  if (!parsed.ok) return parsed.res;
  const body = parsed.data;

  const expense = await prisma.expense.findUnique({
    where: { id },
    include: { verification: { select: { id: true } } },
  });
  if (!expense) return fail(404, "expense.notFound");

  // Only an uncertain one. An export still in flight may yet answer.
  const lock = exportLock(expense.exportClaimState, expense.exportClaimedAt, Date.now());
  if (lock !== "uncertain") {
    return lock === "exporting"
      ? fail(409, "expense.exportInProgress", { values: { name: "-" } })
      : fail(409, "expense.nothingToResolve");
  }

  const theLock = {
    id: expense.id,
    status: "BOOKED" as const,
    exportClaimState: expense.exportClaimState,
    exportClaimedAt: expense.exportClaimedAt,
  };

  if (body.outcome === "none") {
    const released = await commit(() =>
      prisma.$transaction(async (tx) => {
        applied(await tx.expense.updateMany({ where: theLock, data: CLEARED }));
        await tx.expenseEvent.create({
          data: {
            expenseId: id,
            type: "EXPORT_RELEASED",
            actorId,
            comment: body.comment,
          },
        });
      }),
    );
    if (released instanceof NextResponse) return released;
    return NextResponse.json({ id, status: "BOOKED" });
  }

  // Only a BOOKED utlägg has an export lock to resolve.
  const verification = expense.verification;
  if (!verification) throw new Error(`Expense ${id} is BOOKED but has no verification`);

  // Fortnox's financial-year id is not on a voucher, so it is left unknown, as the export does when Fortnox omits it.
  const created = { series: body.series, number: body.number, year: null };
  const label = `${created.series}-${created.number}`;
  const recorded = await commit(() =>
    recordExport(verification.id, created, async (tx) => {
      applied(
        await tx.expense.updateMany({
          where: theLock,
          data: { status: "EXPORTED", ...CLEARED },
        }),
      );
      await tx.expenseEvent.create({
        data: {
          expenseId: id,
          type: "EXPORTED",
          actorId,
          comment: body.comment ? `${label}: ${body.comment}` : label,
        },
      });
      await notify(
        tx,
        "EXPENSE_EXPORTED",
        [expense.submitterId],
        expenseNotice("exported", expense),
        {
          exclude: [actorId],
        },
      );
    }),
  );
  if (recorded instanceof NextResponse) return recorded;
  deliverSoon();
  return NextResponse.json({ id, status: "EXPORTED", label });
}
