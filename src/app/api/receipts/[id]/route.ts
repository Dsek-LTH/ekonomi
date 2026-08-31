// Serve / delete a single receipt's file. The bytes stream browser ← Next ← MinIO
// (proxy model), so every read is authorized here and MinIO stays internal.
//
// A receipt is only ever as private as the utlägg it belongs to, so both
// handlers ask about the expense rather than about the receipt: whoever may open
// the utlägg may see its receipts, and whoever may delete the utlägg may delete
// them (see lib/api/expense-access.ts).
import { prisma } from "@/lib/server/db";
import { deleteObject, getObjectStream } from "@/lib/server/storage";
import { fail, gate } from "@/lib/api/guard";
import { denyExpenseDelete, denyExpenseView } from "@/lib/api/expense-access";

// Enough of the receipt's expense to judge access by.
const withExpense = {
  include: { expense: { select: { id: true, submitterId: true, status: true } } },
} as const;

// GET /api/receipts/:id: streams the receipt image/PDF back inline.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await gate();
  if (!g.ok) return g.res;

  const receipt = await prisma.receipt.findUnique({ where: { id }, ...withExpense });
  if (!receipt) return fail(404, "receipt.notFound");

  const hidden = await denyExpenseView(g.actor, receipt.expense);
  if (hidden) return fail(404, "receipt.notFound");

  const key = receipt.objectKey;

  // Two very different failures, told apart deliberately. Storage being
  // unreachable is an afternoon's outage and the rest of the app carries on
  // without it; an object that storage says isn't there is a verifikat that has
  // gone missing, which someone has to know about. Letting both fall through as
  // an unhandled 500 said neither.
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
    // Receipts can contain personal/financial data. Never cache shared.
    "Cache-Control": "private, max-age=0, no-store",
    "Content-Disposition": `inline; filename="${encodeURIComponent(receipt.filename)}"`,
  });
  if (obj.contentLength != null) {
    headers.set("Content-Length", String(obj.contentLength));
  }
  return new Response(obj.body, { headers });
}

// DELETE /api/receipts/:id: remove the object from MinIO, then the row.
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await gate();
  if (!g.ok) return g.res;

  const receipt = await prisma.receipt.findUnique({ where: { id }, ...withExpense });
  if (!receipt) return fail(404, "receipt.notFound");

  const hidden = await denyExpenseView(g.actor, receipt.expense);
  if (hidden) return fail(404, "receipt.notFound");
  // Once the utlägg is signed its receipt is part of what was attested, so
  // removing it is an admin's job, the same rule as deleting the utlägg.
  const denied = denyExpenseDelete(g.actor, receipt.expense);
  if (denied) return denied;

  // Bytes first, and the row only if they are actually gone. A receipt file
  // that outlives its row is invisible: nothing in the app lists it and nobody
  // would think to look, so a failure here has to stop the delete rather than
  // be tidied up afterwards. Failing this way is recoverable: the receipt is
  // still there, the user is told, and trying again once storage is back
  // finishes the job (deleting an already-gone object counts as success).
  try {
    await deleteObject(receipt.objectKey);
  } catch (e) {
    console.error(`[receipts] ${receipt.id}: could not delete object, keeping row`, e);
    return fail(503, "receipt.deleteStorageFailed");
  }

  await prisma.receipt.delete({ where: { id } });
  return new Response(null, { status: 204 });
}
