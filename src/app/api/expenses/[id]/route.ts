// Edit an utlägg. Only allowed before signing (see EDITABLE_STATUSES). Records
// an EDITED event with a structured diff + human summary. [id] = expense id.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { deleteObject } from "@/lib/server/storage";
import {
  REIMBURSEMENT_DEADLINE_DAYS,
  isEditable,
  isLateReimbursement,
} from "@/lib/domain/status";
import { isCompleteDate, isFutureDate } from "@/lib/domain/date";
import { expenseLabel } from "@/lib/domain/reference";
import { fail, gate } from "@/lib/api/guard";
import {
  canEditExpense,
  denyExpenseDelete,
  denyExpenseView,
} from "@/lib/api/expense-access";

const toOre = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : null;
};

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const g = await gate();
  if (!g.ok) return g.res;
  const body = await req.json().catch(() => ({}));

  const expense = await prisma.expense.findUnique({
    where: { id },
    include: {
      allocations: { include: { costCenter: true } },
    },
  });
  if (!expense) return fail(404, "expense.notFound");

  const hidden = await denyExpenseView(g.actor, expense);
  if (hidden) return hidden;
  if (!isEditable(expense.status)) {
    return fail(409, "expense.notEditableInStatus", {
      values: { status: { key: `common.status.${expense.status}` } },
    });
  }
  // Seeing an utlägg is not editing it: a resultatansvarig may open one of their
  // result unit's to attest, but the figures stay the submitter's (or an admin's).
  if (!canEditExpense(g.actor, expense)) {
    return fail(403, "expense.noEditAccess");
  }

  const title = typeof body.title === "string" ? body.title.trim() : expense.title;
  if (!title) return fail(422, "expense.descriptionRequired");
  // A date is either cleared, left alone, or a whole YYYY-MM-DD. Anything
  // shorter is rejected rather than read by `new Date`, which turns "2026" into
  // 1 January and "2026-07" into 1 July without saying so.
  if (
    body.purchaseDate !== undefined &&
    body.purchaseDate !== null &&
    body.purchaseDate !== "" &&
    !(typeof body.purchaseDate === "string" && isCompleteDate(body.purchaseDate))
  ) {
    return fail(422, "expense.invalidDate");
  }
  // And it has to be a day that has already been. The wizard greys out the save
  // for one that hasn't, but the rule belongs here: a purchase dated ahead of
  // today didn't happen, and it would sit in the books under a period nobody has
  // reached. An expense already carrying such a date (typed before this existed)
  // can still be saved, as long as this edit isn't what sets it.
  if (
    typeof body.purchaseDate === "string" &&
    isFutureDate(body.purchaseDate)
  ) {
    return fail(422, "expense.futureDate");
  }
  const purchaseDate =
    body.purchaseDate === "" || body.purchaseDate === null
      ? null
      : body.purchaseDate
        ? new Date(body.purchaseDate)
        : expense.purchaseDate;
  const grossAmount = "grossAmount" in body ? toOre(body.grossAmount) : expense.grossAmount;
  const paymentType =
    body.paymentType === "CARD" || body.paymentType === "REIMBURSEMENT"
      ? body.paymentType
      : expense.paymentType;

  // Negative amounts are allowed on both sides: a return (a refunded purchase)
  // is the same utlägg with the sign flipped, and its allocations follow it.
  // The transition route still requires the rows to sum to the gross.

  // Allocations: [{costCenterCode: string, amount: number (SEK), comment?: string}]
  type AllocInput = { costCenterCode: string; amount: number; comment?: string };
  let newAllocs: { costCenterId: string; amount: number; comment: string | null }[] | null = null;
  // The same rows keyed by cost-centre code, for the change comparison below —
  // `newAllocs` holds ids, and rows without a cost centre are dropped, so it
  // can't be lined up with `body.allocations` by index.
  let newAllocKeys: { cc: string; amt: number }[] = [];
  if (Array.isArray(body.allocations)) {
    // A draft may still have rows where no cost centre has been picked yet;
    // they carry no meaning, so they're dropped rather than rejected. Submitting
    // is what insists on a complete distribution.
    const inputs: AllocInput[] = (body.allocations as AllocInput[]).filter(
      (a) => a.costCenterCode?.trim(),
    );
    const codes = [...new Set(inputs.map((a) => a.costCenterCode))];
    const centers = await prisma.costCenter.findMany({ where: { code: { in: codes } } });
    const centerMap = new Map(centers.map((c) => [c.code, c.id]));
    for (const a of inputs) {
      if (!centerMap.has(a.costCenterCode)) {
        return fail(422, "expense.unknownCostCenter", { values: { code: a.costCenterCode } });
      }
    }
    newAllocs = inputs.map((a) => ({
      costCenterId: centerMap.get(a.costCenterCode)!,
      amount: Math.round(a.amount * 100), // SEK → öre
      comment: a.comment?.trim() || null,
    }));
    newAllocKeys = inputs.map((a) => ({
      cc: a.costCenterCode,
      amt: Math.round(a.amount * 100),
    }));
  }

  // Build diff.
  const dateStr = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
  type JsonScalar = string | number | null;
  const diff: Record<string, { from: JsonScalar; to: JsonScalar }> = {};
  const note = (field: string, from: JsonScalar, to: JsonScalar) => {
    if (from !== to) diff[field] = { from, to };
  };
  note("title", expense.title, title);
  note("purchaseDate", dateStr(expense.purchaseDate), dateStr(purchaseDate));
  note("grossAmount", expense.grossAmount, grossAmount);
  note("paymentType", expense.paymentType, paymentType);

  const allocsChanged =
    newAllocs !== null &&
    JSON.stringify(
      expense.allocations.map((a) => ({ cc: a.costCenter.code, amt: a.amount })).sort((a, b) => a.cc.localeCompare(b.cc)),
    ) !==
    JSON.stringify([...newAllocKeys].sort((a, b) => a.cc.localeCompare(b.cc)));
  if (allocsChanged) diff["allocations"] = { from: null, to: null };

  // The filing deadline for an eget utlägg, enforced against what this edit
  // leaves behind rather than what it sends: switching an old sektionskort
  // purchase over to "eget utlägg" makes the same inadmissible claim as typing
  // the old date would.
  //
  // Only when this edit is what sets it, though. A draft can sit untouched long
  // enough to cross the deadline on its own, and refusing every save from then
  // on would strand it — its owner can no longer correct a mistyped date, move
  // it to the section card, or write down what the skattmästare said. Submitting
  // is where a late one is actually stopped, and the transition route says so
  // whatever it was saved as.
  const dateOrTypeChanged = "purchaseDate" in diff || "paymentType" in diff;
  if (
    dateOrTypeChanged &&
    purchaseDate &&
    isLateReimbursement(dateStr(purchaseDate)!, paymentType)
  ) {
    return fail(422, "expense.reimbursementTooLate", {
      values: { days: REIMBURSEMENT_DEADLINE_DAYS },
    });
  }

  const changedFields = Object.keys(diff);
  if (changedFields.length === 0 && !newAllocs) {
    return NextResponse.json({ ok: true, id, changed: 0 });
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.expense.update({
        where: { id: expense.id },
        data: { title, purchaseDate, grossAmount, paymentType },
      });

      if (newAllocs) {
        await tx.expenseCostAllocation.deleteMany({ where: { expenseId: expense.id } });
        if (newAllocs.length > 0) {
          await tx.expenseCostAllocation.createMany({
            data: newAllocs.map((a) => ({
              expenseId: expense.id,
              costCenterId: a.costCenterId,
              amount: a.amount,
              comment: a.comment,
            })),
          });
        }
      }

      if (changedFields.length > 0) {
        // The field names, not a sentence: the timeline reads them back
        // through `expenses.field.<name>` in the reader's own language.
        await tx.expenseEvent.create({
          data: {
            expenseId: expense.id,
            type: "EDITED",
            actorId: g.actor.id,
            comment: changedFields.join(","),
            diff,
          },
        });
      }
    });
  } catch (err) {
    console.error("[PATCH /api/expenses] transaction failed:", err);
    return fail(500, err instanceof Error ? err.message : "database");
  }

  return NextResponse.json({ ok: true, id, changed: changedFields.length }, { status: 200 });
}

// DELETE — admin deletes any; owner deletes own while not yet attested.
export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const g = await gate();
  if (!g.ok) return g.res;

  const expense = await prisma.expense.findUnique({
    where: { id },
    include: { receipts: { select: { objectKey: true, thumbnailKey: true } } },
  });
  if (!expense) return fail(404, "expense.notFound");

  const denied = denyExpenseDelete(g.actor, expense);
  if (denied) return denied;

  // Receipt files first, and the utlägg only if every one of them is gone —
  // deleting an utlägg deletes its receipts by cascade, so the same rule
  // applies as in the single-receipt delete: no file may outlive its row.
  // Every key is attempted rather than stopping at the first failure, so a
  // retry once storage is back always makes progress and eventually completes.
  const keys = expense.receipts.flatMap((r) =>
    [r.objectKey, r.thumbnailKey].filter((k): k is string => Boolean(k)),
  );
  const results = await Promise.allSettled(keys.map((k) => deleteObject(k)));
  const failed = results.filter((r) => r.status === "rejected");
  if (failed.length > 0) {
    console.error(
      `[expenses] ${expenseLabel(expense)}: ${failed.length}/${keys.length} receipt objects could not be deleted, keeping utlägg`,
      failed.map((f) => f.reason),
    );
    return fail(503, "expense.receiptDeleteFailed");
  }

  await prisma.expense.delete({ where: { id: expense.id } });

  return new Response(null, { status: 204 });
}
