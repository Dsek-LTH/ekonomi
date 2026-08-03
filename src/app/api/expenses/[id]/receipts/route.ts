// Receipt upload (proxy model): browser → this route → MinIO. The Next server
// authenticates, validates, stores the bytes in MinIO, and records a Receipt
// row + an audit event in Postgres. MinIO is never exposed to the browser.
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import {
  deleteObject,
  deleteObjectBestEffort,
  putObject,
  receiptKey,
  receiptThumbKey,
} from "@/lib/server/storage";
import { asJpegName, isNormalisableImage, normaliseImage } from "@/lib/server/images";
import { isEditable } from "@/lib/domain/status";
import { SNIFF_BYTES, sniffReceiptType } from "@/lib/domain/file-type";
import { fail, gate } from "@/lib/api/guard";
import { canEditExpense, denyExpenseView } from "@/lib/api/expense-access";

// Generous limit on the *original* upload — images get downscaled on the server.
const MAX_BYTES = 25 * 1024 * 1024; // 25 MB

// POST /api/expenses/:id/receipts — multipart form-data, field "file".
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: expenseId } = await ctx.params;
  const g = await gate();
  if (!g.ok) return g.res;

  // Accept either the cuid (wizard flow) or the human reference (edit page).
  const expense = await prisma.expense.findFirst({
    where: { OR: [{ id: expenseId }, { reference: expenseId }] },
  });
  if (!expense) return fail(404, "expense.notFound");

  // Adding a receipt changes the utlägg, so it follows the edit rule: the
  // submitter (or an admin), and only while the utlägg is still editable.
  const hidden = await denyExpenseView(g.actor, expense);
  if (hidden) return hidden;
  if (!canEditExpense(g.actor, expense)) {
    return fail(403, "expense.noReceiptAccess");
  }
  if (!isEditable(expense.status)) {
    return fail(409, "expense.notChangeableInStatus", {
      values: { status: { key: `common.status.${expense.status}` } },
    });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail(400, "request.expectedMultipart");
  }

  const file = form.get("file");
  if (!(file instanceof File)) return fail(400, "request.noFile");
  if (file.size === 0 || file.size > MAX_BYTES) {
    return fail(413, "receipt.sizeRange", { values: { max: MAX_BYTES } });
  }

  // What the file *is*, from its own first bytes — `file.type` is the client's
  // claim about them and is never used for anything but the error message.
  // Checked against the head alone, before committing to buffering 25 MB.
  const head = new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer());
  const fileType = sniffReceiptType(head);
  if (!fileType) {
    return fail(415, "receipt.unsupportedType", { values: { type: file.type || "?" } });
  }

  const uploaderId = g.actor.id;
  const receiptId = randomUUID();
  const original = Buffer.from(await file.arrayBuffer());

  // An utlägg has one receipt, so uploading is a replace: the panel offers this
  // as a button precisely when a receipt is already there. Everything reading an
  // utlägg takes the newest receipt and only that one (lib/data/expenses.ts), so
  // a previous receipt left in place is unreachable from every page in the app
  // while its file sits in the bucket forever — and unreachable is worse than
  // orphaned, because the row keeps the sweeper from ever noticing it.
  //
  // Nothing attested is discarded this way: uploading at all requires the
  // utlägg to still be editable, which the status check above has established.
  const replaced = await prisma.receipt.findMany({
    where: { expenseId: expense.id },
    select: { id: true, objectKey: true, thumbnailKey: true },
  });

  // Images are normalised (HEIC→JPEG, EXIF-rotated, downscaled) and get a
  // thumbnail; PDFs are stored as-is. Collect the objects to write, plus the
  // row's metadata, then persist atomically (object first, row second).
  let filename = file.name;
  let mimeType: string = fileType;
  let byteSize = file.size;
  let thumbnailKey: string | null = null;
  const objects: { key: string; body: Buffer; contentType: string }[] = [];

  if (isNormalisableImage(fileType)) {
    let normalised;
    try {
      normalised = await normaliseImage(original);
    } catch {
      return fail(422, "receipt.unreadable");
    }
    filename = asJpegName(file.name);
    mimeType = normalised.mimeType;
    byteSize = normalised.full.length;
    thumbnailKey = receiptThumbKey(expense.id, receiptId);
    objects.push({ key: receiptKey(expense.id, receiptId, filename), body: normalised.full, contentType: mimeType });
    objects.push({ key: thumbnailKey, body: normalised.thumb, contentType: "image/jpeg" });
  } else {
    objects.push({ key: receiptKey(expense.id, receiptId, file.name), body: original, contentType: fileType });
  }
  const objectKey = objects[0].key;

  // Store bytes first; only write the row if that succeeds (no orphan rows).
  // Both the writes and the row are inside the try, because a half-finished
  // write orphans just as surely as a failed row does: an image writes its
  // thumbnail and its full-size object separately, and either can be the one
  // that lands. Whatever got as far as the bucket is removed on the way out.
  try {
    await Promise.all(objects.map((o) => putObject(o.key, o.body, o.contentType)));

    // The replaced receipt's files go before its row, and before anything is
    // committed — the same rule as an outright delete, applied at the only
    // other point a receipt stops being current. Failing here changes nothing
    // at all: the new objects are rolled back below and the old receipt is
    // still the utlägg's, so trying again once storage is back is safe.
    const staleKeys = replaced.flatMap((r) =>
      [r.objectKey, r.thumbnailKey].filter((k): k is string => Boolean(k)),
    );
    const swept = await Promise.allSettled(staleKeys.map((k) => deleteObject(k)));
    const stuck = swept.filter((s) => s.status === "rejected");
    if (stuck.length > 0) {
      console.error(
        `[receipts] ${expense.reference}: ${stuck.length}/${staleKeys.length} replaced objects could not be deleted, keeping previous receipt`,
        stuck.map((s) => s.reason),
      );
      await Promise.all(objects.map((o) => deleteObjectBestEffort(o.key)));
      return fail(503, "receipt.replaceStorageFailed");
    }

    const receipt = await prisma.$transaction(async (tx) => {
      // In with the new and out with the old together, so the utlägg is never
      // momentarily without a receipt and never briefly holding two.
      if (replaced.length > 0) {
        await tx.receipt.deleteMany({ where: { id: { in: replaced.map((r) => r.id) } } });
      }
      const created = await tx.receipt.create({
        data: {
          id: receiptId,
          expenseId: expense.id,
          objectKey,
          thumbnailKey,
          filename,
          mimeType,
          byteSize,
          uploadedById: uploaderId,
        },
      });
      await tx.expenseEvent.create({
        data: {
          expenseId: expense.id,
          type: "RECEIPT_UPLOADED",
          actorId: uploaderId,
        },
      });
      return created;
    });
    return NextResponse.json(receipt, { status: 201 });
  } catch (err) {
    // Roll back whatever reached the bucket. Deleting a key that was never
    // written is a no-op, so this needs no record of which writes succeeded.
    await Promise.all(objects.map((o) => deleteObjectBestEffort(o.key)));
    throw err;
  }
}

// GET /api/expenses/:id/receipts — list a receipt's metadata (not the bytes).
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: expenseId } = await ctx.params;
  const g = await gate();
  if (!g.ok) return g.res;

  const expense = await prisma.expense.findFirst({
    where: { OR: [{ id: expenseId }, { reference: expenseId }] },
  });
  if (!expense) return fail(404, "expense.notFound");

  const hidden = await denyExpenseView(g.actor, expense);
  if (hidden) return hidden;

  const receipts = await prisma.receipt.findMany({
    where: { expenseId: expense.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      filename: true,
      mimeType: true,
      byteSize: true,
      createdAt: true,
    },
  });
  return NextResponse.json(receipts);
}
