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
import { isFutureDate } from "@/lib/domain/date";
import { isMatchable } from "@/lib/domain/matching";
import { expenseLabel } from "@/lib/domain/reference";
import { fail, gate } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { PatchExpense } from "@/lib/api/schemas/expense";
import { valueForStorage } from "@/lib/mileage/store";
import { deliverSoon, notify } from "@/lib/server/notify";
import { expenseNotice } from "@/lib/email/content";
import {
  canEditExpense,
  denyExpenseDelete,
  denyExpenseView,
} from "@/lib/api/expense-access";

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
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
    // The one refusal here that somebody can do something about says what:
    // an utlägg out for attest is not stuck, it is held, and recalling it hands
    // it back. Every other status on this branch is signed or beyond, where the
    // answer is genuinely "not yours any more".
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

  // Absent means "leave it": this patches an utlägg that already exists, so
  // every field falls back to what is stored. The *shape* of each one (a whole
  // date, an integer öre, one of the two payment types) is the schema's
  // business now and is not re-checked here.
  const title = body.title ?? expense.title;
  // The schema guarantees a title that was *sent* says something; it cannot
  // speak for the one already stored. A draft may have been created without
  // one, and this is still where an utlägg stops being allowed to have no name.
  if (!title.trim()) return fail(422, "expense.descriptionRequired");
  // A day that has already been. The wizard greys out the save for one that
  // hasn't, but the rule belongs here: a purchase dated ahead of today didn't
  // happen, and it would sit in the books under a period nobody has reached. An
  // utlägg already carrying such a date (typed before this existed) can still be
  // saved, as long as this edit isn't what sets it.
  if (body.purchaseDate && isFutureDate(body.purchaseDate)) {
    return fail(422, "expense.futureDate");
  }
  // Stored as @db.Date, i.e. midnight UTC, so the ISO day is the day meant.
  // Declared here rather than beside the diff below because the mileage
  // valuation needs it first.
  const dateStr = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
  const purchaseDate =
    body.purchaseDate === undefined
      ? expense.purchaseDate
      : body.purchaseDate === null
        ? null
        : new Date(body.purchaseDate);
  const paymentType = body.paymentType ?? expense.paymentType;

  // The odometer at each end, and what the journey between them is worth.
  //
  // Absent means "leave it", like every other field here, so a save that only
  // touches the distribution does not have to re-send the readings. The rate is
  // resolved against the date this edit *leaves behind*, not the one it sends:
  // correcting a journey's day to one under a different schablon has to move
  // the amount with it, or the claim would go on being worth what the old day
  // said.
  //
  // Null on every other payment type, and *cleared* by an edit that moves off
  // MILEAGE. These columns describe a journey, and an utlägg that is no
  // longer a milersättning has none. They used to be spread in only when there
  // was something to value, which left the readings and the schablon sitting on
  // a receipt claim for the rest of its life, with the timeline going on to
  // record edits to them.
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
  // Where it went, on the same terms as the readings: absent leaves it, and
  // moving off MILEAGE empties it. The stops are not decoration on the
  // distance. They are what says the driving was the section's errand, and
  // `claimBlocker` refuses to send a claim naming fewer than two places.
  //
  // Replaced whole, never merged. The list's order is its meaning, so there is
  // no sensible way to fold a sent list into a stored one; the client holds the
  // editor and sends what it now reads.
  const journeyStops = !isMileage ? [] : (body.journeyStops ?? expense.journeyStops);

  const valued = isMileage
    ? await valueForStorage({
        date: purchaseDate ? dateStr(purchaseDate)! : "",
        odometerStart,
        odometerEnd,
      })
    : null;

  // On a milersättning the amount is never the client's. It is the distance
  // between the two readings at the day's rate, and this is where that is
  // settled whatever the request said.
  const grossAmount = valued
    ? valued.grossAmount
    : body.grossAmount === undefined
      ? expense.grossAmount
      : body.grossAmount;

  // Switching off the section card gives the bank transaction back.
  //
  // A match says a particular row on the card is the money that left for this
  // purchase (see isMatchable). "Eget utlägg" says the member's own money left
  // and the section owes them it back, so an utlägg holding both has the
  // section paying for one purchase twice, once on the card and once into a
  // member's account, with the card row marked accounted for either way.
  //
  // Dropped rather than refused: picking a payment type is the submitter's
  // call to make on this form, and the match is a consequence of the old
  // answer, not a separate thing they said. It goes back to being an
  // unaccounted purchase on the card-purchases list, and the timeline records
  // the UNMATCHED the same as pressing unmatch would.
  //
  // Not conditional on the type having *changed* in this edit: an utlägg that
  // already holds the pair (they were reachable together before the create
  // route refused it) is repaired by the next save rather than left alone.
  const dropMatch = Boolean(expense.matchedTransactionId) && !isMatchable(paymentType);

  // Negative amounts are allowed on both sides: a return (a refunded purchase)
  // is the same utlägg with the sign flipped, and its allocations follow it.
  // The transition route still requires the rows to sum to the gross.

  // Allocations, in öre, like every other amount here and like the column they
  // are stored in. Shape guaranteed by AllocationInput.
  let newAllocs: { costCenterId: string; amount: number; comment: string | null }[] | null = null;
  // The same rows keyed by cost-centre code, for the change comparison below.
  // `newAllocs` holds ids, and rows without a cost centre are dropped, so it
  // can't be lined up with `body.allocations` by index.
  //
  // The comment is part of the key. It was left out, and since a comment-only
  // edit changes no other field, the write went through while the timeline
  // recorded nothing at all, on the one screen whose purpose is to say what
  // happened to an utlägg and who did it.
  let newAllocKeys: { cc: string; amt: number; comment: string | null }[] = [];
  if (body.allocations) {
    // A draft may still have rows where no cost centre has been picked yet;
    // they carry no meaning, so they're dropped rather than rejected. Submitting
    // is what insists on a complete distribution.
    const inputs = body.allocations.filter((a) => a.costCenterCode !== "");
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
      amount: a.amount,
      comment: a.comment?.trim() || null,
    }));
    newAllocKeys = newAllocs.map((a, i) => ({
      cc: inputs[i].costCenterCode,
      amt: a.amount,
      comment: a.comment,
    }));
  }

  // Build diff.
  type JsonScalar = string | number | null;
  const diff: Record<string, { from: JsonScalar; to: JsonScalar }> = {};
  const note = (field: string, from: JsonScalar, to: JsonScalar) => {
    if (from !== to) diff[field] = { from, to };
  };
  note("title", expense.title, title);
  note("purchaseDate", dateStr(expense.purchaseDate), dateStr(purchaseDate));
  note("grossAmount", expense.grossAmount, grossAmount);
  // Each on its own, so the timeline can say which end of the journey was
  // corrected rather than only that "the mileage changed".
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
  // One line for the whole list, joined, because the diff holds JSON scalars
  // and because "the route changed" is what the timeline has to say either way.
  // Only the field *name* reaches the reader, so what these read as never shows.
  note("journeyStops", expense.journeyStops.join(" → "), journeyStops.join(" → "));
  note("paymentType", expense.paymentType, paymentType);

  // Each row compared whole, as a string, and the rows sorted by that string.
  // Sorting by code alone left two rows on the same cost centre tied, and a
  // tie could come back in either order and read as a change.
  const allocRows = (rows: { cc: string; amt: number; comment: string | null }[]) =>
    rows.map((r) => JSON.stringify(r)).sort().join("\n");
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

  // The filing deadline is not enforced here at all, and that is deliberate.
  //
  // This route used to refuse a save that *set* a late date, on the grounds
  // that an inadmissible claim should not be written down. That was right while
  // a late claim could never be paid. It stopped being right the moment a
  // dispens existed: a dispens is granted against a claim, by somebody looking
  // at it, and a claim that cannot be saved is one nobody can look at. The
  // wizard would neither continue nor save on a receipt two months old, so
  // there was nothing for the skattmästare to decide about.
  //
  // Submitting is where a late one is stopped, and the transition route says so
  // whatever this was saved as. Writing down a purchase that happened is not
  // the same act as claiming the money for it.
  const dateOrTypeChanged = "purchaseDate" in diff || "paymentType" in diff;

  // A dispens is granted against one claim, and the two fields the deadline is
  // read from are what make it that claim. Change either and the dispens is
  // spent: the skattmästare allowed a purchase on a date, not this utlägg
  // forever. Without this, a waived draft could be re-dated or moved to another
  // payment type and carry its dispens over to a claim nobody looked at.
  //
  // Deliberately not the amount. The dispens says a late claim may be filed at
  // all; what it is worth is the attest's question, and every krona still has
  // to be signed for by whoever answers for the cost centre. Clearing it on
  // every öre corrected would only teach a treasurer to re-grant without
  // reading.
  const dropWaiver = dateOrTypeChanged && expense.deadlineWaivedAt !== null;

  // A changed distribution is one of the fields in `diff`, so this covers the
  // allocations too. It used to let a request that carried allocations through
  // even when they were identical, which opened a transaction to rewrite four
  // rows into the same four rows and log nothing.
  const changedFields = Object.keys(diff);
  // `dropMatch` is work of its own: it isn't one of the diffed fields, and on
  // an utlägg already holding the contradictory pair it can be the only thing
  // this save has to do. `dropWaiver` never is: it only ever follows a changed
  // date or payment type, both of which are diffed fields.
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
          // The journey, on a milersättning and only there: where it went, the
          // readings at each end, and the rate that valued the distance.
          // Written onto the claim rather than looked up when it is read, so
          // the amount stays checkable after the schablon moves, and written
          // unconditionally so that moving off MILEAGE takes them back off,
          // rather than leaving a journey on a claim that no longer has one.
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

      // Its own event, beside the EDITED one rather than inside it. The edit is
      // the submitter's; losing the dispens is what it cost them, and a
      // timeline that only said "Uppdaterade uppgifter" would leave them to
      // discover it at the submit button.
      if (dropWaiver) {
        await tx.expenseEvent.create({
          data: {
            expenseId: expense.id,
            type: "DEADLINE_WAIVER_REVOKED",
            actorId: g.actor.id,
          },
        });
        // Only reaches anyone when somebody else made the edit. The submitter
        // changing their own date has the form telling them already.
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

      // Its own event, not a line in the diff: the timeline already has a word
      // for a match coming off, and this is that, whoever pressed what.
      //
      // Quiet before the first submission, same as the EDITED event below: see
      // isQuietDraftEdit.
      if (dropMatch && !isQuietDraftEdit(expense, g.actor.id)) {
        await tx.expenseEvent.create({
          data: { expenseId: expense.id, type: "UNMATCHED", actorId: g.actor.id },
        });
      }

      // Only when they actually differ. Rewriting an identical distribution
      // dropped and recreated every row for nothing, and left the write and
      // the timeline disagreeing about whether anything had happened.
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

      // Quiet before the first submission (see isQuietDraftEdit): a save made
      // while filling in a draft nobody else has seen yet is not an edit to an
      // utlägg, it is the utlägg still being written, and the timeline says so
      // with the CREATED event alone. The change is still made; only the extra
      // line about it is skipped.
      if (changedFields.length > 0 && !isQuietDraftEdit(expense, g.actor.id)) {
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
    // The reason goes to the log, not to the browser. A Prisma error message
    // names columns, constraints and sometimes the values that violated them,
    // none of which is the caller's to read, and none of which they could act
    // on. `error` carries a code the client translates (see lib/api/guard.ts);
    // this used to hand the raw message over as though it were one.
    console.error("[PATCH /api/expenses] transaction failed:", err);
    return fail(500, "database");
  }

  if (dropWaiver) deliverSoon();
  return NextResponse.json({ id, changed: changedFields.length }, { status: 200 });
}

// DELETE: admin deletes any; owner deletes own while not yet attested.
export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const g = await gate();
  if (!g.ok) return g.res;

  const expense = await prisma.expense.findUnique({
    where: { id },
    include: { receipts: { select: { objectKey: true } } },
  });
  if (!expense) return fail(404, "expense.notFound");

  const denied = denyExpenseDelete(g.actor, expense);
  if (denied) return denied;

  // Receipt files first, and the utlägg only if every one of them is gone.
  // deleting an utlägg deletes its receipts by cascade, so the same rule
  // applies as in the single-receipt delete: no file may outlive its row.
  // Every key is attempted rather than stopping at the first failure, so a
  // retry once storage is back always makes progress and eventually completes.
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

  await prisma.expense.delete({ where: { id: expense.id } });

  return new Response(null, { status: 204 });
}
