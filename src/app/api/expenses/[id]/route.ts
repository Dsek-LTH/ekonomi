// Edit an utlägg. Only allowed before signing (see EDITABLE_STATUSES). Records
// an EDITED event with a structured diff + human summary. [id] = expense id.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { deleteObject } from "@/lib/server/storage";
import {
  REIMBURSEMENT_DEADLINE_DAYS,
  isEditable,
  isQuietDraftEdit,
  isRecallable,
} from "@/lib/domain/status";
import { isFutureDate, isoDay } from "@/lib/domain/date";
import { isMatchable } from "@/lib/domain/matching";
import { exportLock } from "@/lib/domain/export-claim";
import { expenseLabel } from "@/lib/domain/reference";
import { fail, gate } from "@/lib/api/guard";
import { denyOutsideFiscalYear } from "@/lib/api/fiscal-year";
import { parseBody } from "@/lib/api/parse";
import { PatchExpense } from "@/lib/api/schemas/expense";
import { valueForStorage } from "@/lib/mileage/store";
import { deliverSoon, notify } from "@/lib/server/notify";
import { expenseNotice } from "@/lib/email/content";
import { canEditExpense, denyExpenseDelete, denyExpenseView } from "@/lib/api/expense-access";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await gate();
  if (!g.ok) return g.res;
  const parsed = await parseBody(req, PatchExpense);
  if (!parsed.ok) return parsed.res;
  const body = parsed.data;

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
    // An utlägg out for attest is held, not stuck: recalling it hands it back. Other statuses here are signed or beyond.
    return isRecallable(expense.status)
      ? fail(409, "expense.editWhilePendingAttest")
      : fail(409, "expense.notEditableInStatus", {
          values: { status: { key: `common.status.${expense.status}` } },
        });
  }
  // Seeing an utlägg is not editing it: a resultatansvarig may open one of their
  // result unit's to attest, but the figures stay the submitter's (or an admin's).
  if (!canEditExpense(g.actor, expense)) {
    return fail(403, "expense.noEditAccess");
  }

  // Absent means "leave it": every field falls back to what is stored. Shapes are the schema's business.
  const title = body.title ?? expense.title;
  // The schema checks a sent title, but a stored one may be empty (draft), so this is where an utlägg must get a name.
  if (!title.trim()) return fail(422, "expense.descriptionRequired");
  // A purchase dated ahead of today did not happen. An utlägg already carrying such a date can still be saved unless this edit sets it.
  if (body.purchaseDate && isFutureDate(body.purchaseDate)) {
    return fail(422, "expense.futureDate");
  }
  // @db.Date is midnight UTC, so the ISO day is the day meant. Declared early: the mileage valuation needs it.
  const dateStr = (d: Date | null) => (d ? isoDay(d) : null);
  // In the year picked in the header, so the utlägg stays in its list. Same allowance as above: only when this edit sets the date.
  if (body.purchaseDate && body.purchaseDate !== dateStr(expense.purchaseDate)) {
    const offYear = await denyOutsideFiscalYear(body.purchaseDate);
    if (offYear) return offYear;
  }
  const purchaseDate =
    body.purchaseDate === undefined
      ? expense.purchaseDate
      : body.purchaseDate === null
        ? null
        : new Date(body.purchaseDate);
  const paymentType = body.paymentType ?? expense.paymentType;

  // Odometer readings and the journey's value. Absent leaves them. The rate is resolved against the date this edit leaves behind,
  // so correcting a day moves the amount. Null on other payment types, and cleared when moving off MILEAGE.
  const isMileage = paymentType === "MILEAGE";
  const odometerStart = !isMileage
    ? null
    : body.odometerStart === undefined
      ? expense.odometerStart == null
        ? null
        : Number(expense.odometerStart)
      : body.odometerStart;
  const odometerEnd = !isMileage
    ? null
    : body.odometerEnd === undefined
      ? expense.odometerEnd == null
        ? null
        : Number(expense.odometerEnd)
      : body.odometerEnd;
  // Where it went: absent leaves it, moving off MILEAGE empties it. `claimBlocker` refuses fewer than two places.
  // Replaced whole, never merged: the list's order is its meaning.
  const journeyStops = !isMileage ? [] : (body.journeyStops ?? expense.journeyStops);

  const valued = isMileage
    ? await valueForStorage({
        date: purchaseDate ? dateStr(purchaseDate)! : "",
        odometerStart,
        odometerEnd,
      })
    : null;

  // On a milersättning the amount is never the client's: it is the distance between the readings at the day's rate.
  const grossAmount = valued
    ? valued.grossAmount
    : body.grossAmount === undefined
      ? expense.grossAmount
      : body.grossAmount;

  // Switching off the section card gives the bank transaction back: a match plus "Eget utlägg" would pay one purchase twice (see isMatchable).
  // Dropped rather than refused, and not conditional on the type having changed, so an utlägg already holding the pair is repaired by the next save.
  const dropMatch = Boolean(expense.matchedTransactionId) && !isMatchable(paymentType);

  // Negative amounts are allowed (a refunded purchase). The transition route still requires the rows to sum to the gross.

  // Allocations, in öre.
  let newAllocs: { costCenterId: string; amount: number; comment: string | null }[] | null = null;
  // The same rows keyed by cost-centre code, for the change comparison below (`newAllocs` holds ids, so it can't be lined up by index).
  // The comment is part of the key, or a comment-only edit would write without a timeline event.
  let newAllocKeys: { cc: string; amt: number; comment: string | null }[] = [];
  if (body.allocations) {
    // A draft may have rows with no cost centre yet: dropped, not rejected. Submitting insists on a complete distribution.
    const inputs = body.allocations.filter((a) => a.costCenterCode !== "");
    const codes = [...new Set(inputs.map((a) => a.costCenterCode))];
    const centers = await prisma.costCenter.findMany({ where: { code: { in: codes } } });
    const centerMap = new Map(centers.map((c) => [c.code, c.id]));
    for (const a of inputs) {
      if (!centerMap.has(a.costCenterCode)) {
        return fail(422, "expense.unknownCostCenter", {
          values: { code: a.costCenterCode },
        });
      }
    }
    newAllocs = inputs.map((a) => ({
      costCenterId: centerMap.get(a.costCenterCode)!,
      amount: a.amount,
      comment: a.comment?.trim() || null,
    }));
    newAllocKeys = newAllocs.map((a, i) => ({
      cc: inputs[i].costCenterCode,
      amt: a.amount,
      comment: a.comment,
    }));
  }

  type JsonScalar = string | number | null;
  const diff: Record<string, { from: JsonScalar; to: JsonScalar }> = {};
  const note = (field: string, from: JsonScalar, to: JsonScalar) => {
    if (from !== to) diff[field] = { from, to };
  };
  note("title", expense.title, title);
  note("purchaseDate", dateStr(expense.purchaseDate), dateStr(purchaseDate));
  note("grossAmount", expense.grossAmount, grossAmount);
  // Each on its own, so the timeline says which end was corrected.
  note(
    "odometerStart",
    expense.odometerStart == null ? null : Number(expense.odometerStart),
    odometerStart,
  );
  note(
    "odometerEnd",
    expense.odometerEnd == null ? null : Number(expense.odometerEnd),
    odometerEnd,
  );
  // One line for the whole list: the diff holds JSON scalars. Only the field name reaches the reader.
  note("journeyStops", expense.journeyStops.join(" → "), journeyStops.join(" → "));
  note("paymentType", expense.paymentType, paymentType);

  // Each row compared whole as a string and sorted by it: sorting by code alone left same-centre rows in unstable order.
  const allocRows = (rows: { cc: string; amt: number; comment: string | null }[]) =>
    rows
      .map((r) => JSON.stringify(r))
      .sort()
      .join("\n");
  const allocsChanged =
    newAllocs !== null &&
    allocRows(
      expense.allocations.map((a) => ({
        cc: a.costCenter.code,
        amt: a.amount,
        comment: a.comment ?? null,
      })),
    ) !== allocRows(newAllocKeys);
  if (allocsChanged) diff["allocations"] = { from: null, to: null };

  // The filing deadline is deliberately not enforced here: a dispens is granted against a claim somebody can look at,
  // so a late claim must be saveable. Submitting stops it (transition route).
  const dateOrTypeChanged = "purchaseDate" in diff || "paymentType" in diff;

  // A dispens is granted against one claim, which the purchase date and payment type identify: changing either spends it.
  // Not the amount: the attest signs for every krona anyway.
  const dropWaiver = dateOrTypeChanged && expense.deadlineWaivedAt !== null;

  // A changed distribution is one of the fields in `diff`.
  const changedFields = Object.keys(diff);
  // `dropMatch` can be the only work of a save on an utlägg holding the contradictory pair. `dropWaiver` always follows a diffed field.
  if (changedFields.length === 0 && !dropMatch) {
    return NextResponse.json({ id, changed: 0 });
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.expense.update({
        where: { id: expense.id },
        data: {
          title,
          purchaseDate,
          grossAmount,
          paymentType,
          // The journey, on a milersättning only. Written onto the claim so the amount stays checkable after the schablon moves,
          // and unconditionally so moving off MILEAGE clears it.
          odometerStart,
          odometerEnd,
          journeyStops,
          mileageOrePerKm: valued?.orePerKm ?? null,
          ...(dropMatch ? { matchedTransactionId: null } : {}),
          ...(dropWaiver
            ? {
                deadlineWaivedById: null,
                deadlineWaivedAt: null,
                deadlineWaiverReason: null,
              }
            : {}),
        },
      });

      // Its own event beside EDITED: the submitter should learn the dispens was lost.
      if (dropWaiver) {
        await tx.expenseEvent.create({
          data: {
            expenseId: expense.id,
            type: "DEADLINE_WAIVER_REVOKED",
            actorId: g.actor.id,
          },
        });
        // Only reaches anyone when somebody else made the edit.
        await notify(
          tx,
          "EXPENSE_DEADLINE_WAIVER_REVOKED",
          [expense.submitterId],
          expenseNotice(
            "waiverRevoked",
            { id: expense.id, reference: expense.reference, title, grossAmount },
            { days: REIMBURSEMENT_DEADLINE_DAYS },
          ),
          { exclude: [g.actor.id] },
        );
      }

      // Its own event, not a line in the diff. Quiet before the first submission (isQuietDraftEdit).
      if (dropMatch && !isQuietDraftEdit(expense, g.actor.id)) {
        await tx.expenseEvent.create({
          data: { expenseId: expense.id, type: "UNMATCHED", actorId: g.actor.id },
        });
      }

      // Only when they actually differ.
      if (newAllocs && allocsChanged) {
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

      // Quiet before the first submission (isQuietDraftEdit): the CREATED event alone tells the story.
      if (changedFields.length > 0 && !isQuietDraftEdit(expense, g.actor.id)) {
        // The field names, read back through `expenses.field.<name>` in the reader's language.
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
    // The reason goes to the log: a Prisma message names columns and values. `error` carries a code the client translates (lib/api/guard.ts).
    console.error("[PATCH /api/expenses] transaction failed:", err);
    return fail(500, "database");
  }

  if (dropWaiver) deliverSoon();
  return NextResponse.json({ id, changed: changedFields.length }, { status: 200 });
}

// DELETE: admin deletes any; owner deletes own while not yet attested.
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await gate();
  if (!g.ok) return g.res;

  const expense = await prisma.expense.findUnique({
    where: { id },
    include: {
      receipts: { select: { objectKey: true } },
      exportClaimedBy: { select: { name: true } },
    },
  });
  if (!expense) return fail(404, "expense.notFound");

  const denied = denyExpenseDelete(g.actor, expense);
  if (denied) return denied;

  // Not while an export holds it: Fortnox cannot take the voucher back. Asked before the files go, so a refusal deletes nothing.
  const lock = exportLock(expense.exportClaimState, expense.exportClaimedAt, Date.now());
  if (lock !== "free") {
    return fail(
      409,
      lock === "exporting" ? "expense.exportInProgress" : "expense.exportUncertain",
      {
        values: { name: expense.exportClaimedBy?.name ?? "-" },
      },
    );
  }

  // Receipt files first, the utlägg only if every one is gone (no file may outlive its row). Every key is attempted so a retry makes progress.
  const keys = expense.receipts.map((r) => r.objectKey);
  const results = await Promise.allSettled(keys.map((k) => deleteObject(k)));
  const failed = results.filter((r) => r.status === "rejected");
  if (failed.length > 0) {
    console.error(
      `[expenses] ${expenseLabel(expense)}: ${failed.length}/${keys.length} receipt objects could not be deleted, keeping utlägg`,
      failed.map((f) => f.reason),
    );
    return fail(503, "expense.receiptDeleteFailed");
  }

  // Again in the delete itself, for an export that took the lock while the files were going.
  const { count } = await prisma.expense.deleteMany({
    where: {
      id: expense.id,
      exportClaimState: expense.exportClaimState,
      exportClaimedAt: expense.exportClaimedAt,
    },
  });
  if (count === 0) return fail(409, "expense.changedMeanwhile");

  return new Response(null, { status: 204 });
}
