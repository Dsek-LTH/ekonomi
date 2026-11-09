// Serve or delete a receipt's file, proxied from MinIO so every read is authorized here.
// Both handlers ask about the utlägg, not the receipt: whoever may open it may see its
// receipts, and removing one is an edit (lib/api/expense-access.ts, isEditable).
import { prisma } from "@/lib/server/db";
import { deleteObject, getObjectStream } from "@/lib/server/storage";
import { fail, gate } from "@/lib/api/guard";
import { canEditExpense, denyExpenseView } from "@/lib/api/expense-access";
import { isEditable, isQuietDraftEdit, isRecallable } from "@/lib/domain/status";

const withExpense = {
  include: {
    expense: { select: { id: true, submitterId: true, status: true, reference: true } },
  },
} as const;

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await gate();
  if (!g.ok) return g.res;

  const receipt = await prisma.receipt.findUnique({ where: { id }, ...withExpense });
  if (!receipt) return fail(404, "receipt.notFound");

  const hidden = await denyExpenseView(g.actor, receipt.expense);
  if (hidden) return fail(404, "receipt.notFound");

  const key = receipt.objectKey;

  // Told apart on purpose: storage down is an outage, a missing object is a lost verifikat
  // someone must know about.
  let obj;
  try {
    obj = await getObjectStream(key);
  } catch (e) {
    const name = (e as { name?: string }).name;
    if (name === "NoSuchKey" || name === "NotFound") {
      console.error(`[receipts] ${receipt.id}: object ${key} is gone`, e);
      return fail(404, "receipt.fileMissing");
    }
    console.error(`[receipts] ${receipt.id}: storage unreachable`, e);
    return fail(503, "receipt.storageUnavailable");
  }
  const headers = new Headers({
    "Content-Type": obj.contentType,
    "Cache-Control": "private, max-age=0, no-store",
    "Content-Disposition": `inline; filename="${encodeURIComponent(receipt.filename)}"`,
  });
  if (obj.contentLength != null) {
    headers.set("Content-Length", String(obj.contentLength));
  }
  return new Response(obj.body, { headers });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await gate();
  if (!g.ok) return g.res;

  const receipt = await prisma.receipt.findUnique({ where: { id }, ...withExpense });
  if (!receipt) return fail(404, "receipt.notFound");

  const hidden = await denyExpenseView(g.actor, receipt.expense);
  if (hidden) return fail(404, "receipt.notFound");
  if (!canEditExpense(g.actor, receipt.expense)) {
    return fail(403, "expense.noReceiptAccess");
  }
  // The upload route's rule: an utlägg out for attest is not the submitter's to change.
  if (!isEditable(receipt.expense.status)) {
    return isRecallable(receipt.expense.status)
      ? fail(409, "expense.editWhilePendingAttest")
      : fail(409, "expense.notChangeableInStatus", {
          values: { status: { key: `common.status.${receipt.expense.status}` } },
        });
  }

  // Bytes first, and the row only if they are gone: a file outliving its row is invisible.
  // Retrying after a failure finishes the job (deleting an absent object counts as success).
  try {
    await deleteObject(receipt.objectKey);
  } catch (e) {
    console.error(`[receipts] ${receipt.id}: could not delete object, keeping row`, e);
    return fail(503, "receipt.deleteStorageFailed");
  }

  await prisma.$transaction(async (tx) => {
    await tx.receipt.delete({ where: { id } });
    // Quiet before the first submission; see isQuietDraftEdit.
    if (!isQuietDraftEdit(receipt.expense, g.actor.id)) {
      await tx.expenseEvent.create({
        data: {
          expenseId: receipt.expense.id,
          type: "RECEIPT_REMOVED",
          actorId: g.actor.id,
        },
      });
    }
  });
  return new Response(null, { status: 204 });
}
