// Receipt upload (proxy model): browser -> this route -> MinIO. MinIO is never exposed to the browser.
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { deleteObjectBestEffort, putObject, receiptKey } from "@/lib/server/storage";
import { isNormalisableImage, normaliseImage, normalisedName } from "@/lib/server/images";
import { isEditable, isQuietDraftEdit, isRecallable } from "@/lib/domain/status";
import { SNIFF_BYTES, sniffReceiptType } from "@/lib/domain/file-type";
import { fail, gate } from "@/lib/api/guard";
import { canEditExpense, denyExpenseView } from "@/lib/api/expense-access";
import { RECEIPT_ORDER } from "@/lib/data/receipt-order";

// Generous limit on the original upload. Images get downscaled on the server.
const MAX_BYTES = 25 * 1024 * 1024; // 25 MB

// The multipart envelope is a little larger than the file. Loose on purpose: `file.size` below holds the limit.
const MAX_BODY_BYTES = MAX_BYTES + 1024 * 1024;

// POST /api/expenses/:id/receipts: multipart form-data, field "file".
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: expenseId } = await ctx.params;
  const g = await gate();
  if (!g.ok) return g.res;

  const expense = await prisma.expense.findUnique({ where: { id: expenseId } });
  if (!expense) return fail(404, "expense.notFound");

  // Adding a receipt follows the edit rule: the submitter (or an admin), while the utlägg is still editable.
  const hidden = await denyExpenseView(g.actor, expense);
  if (hidden) return hidden;
  if (!canEditExpense(g.actor, expense)) {
    return fail(403, "expense.noReceiptAccess");
  }
  if (!isEditable(expense.status)) {
    // Same rule as the PATCH beside it: the underlag must not be swapped under an attester who is reading it.
    return isRecallable(expense.status)
      ? fail(409, "expense.editWhilePendingAttest")
      : fail(409, "expense.notChangeableInStatus", {
          values: { status: { key: `common.status.${expense.status}` } },
        });
  }

  // Before the body is touched: `req.formData()` buffers the whole request. Content-Length is the sender's claim,
  // enough here, since the real limit still applies once the bytes are counted.
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return fail(413, "receipt.sizeRange", { values: { max: MAX_BYTES } });
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

  // What the file is, from its first bytes. `file.type` is the client's claim, used only for the error message.
  const head = new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer());
  const fileType = sniffReceiptType(head);
  if (!fileType) {
    return fail(415, "receipt.unsupportedType", { values: { type: file.type || "?" } });
  }

  const uploaderId = g.actor.id;
  const receiptId = randomUUID();
  const original = Buffer.from(await file.arrayBuffer());

  // Images are normalised (HEIC to JPEG, EXIF-rotated, downscaled, PNG when see-through). PDFs are stored as-is.
  // Persist atomically: object first, row second.
  let filename = file.name;
  let mimeType: string = fileType;
  let byteSize = file.size;
  // Annotated, not inferred: `original` narrows to Buffer<ArrayBuffer> but putObject takes the wider Buffer.
  let body: Buffer = original;

  if (isNormalisableImage(fileType)) {
    let normalised;
    try {
      normalised = await normaliseImage(original);
    } catch {
      return fail(422, "receipt.unreadable");
    }
    filename = normalisedName(file.name, normalised.mimeType);
    mimeType = normalised.mimeType;
    byteSize = normalised.full.length;
    body = normalised.full;
  }
  const objectKey = receiptKey(expense.id, receiptId, filename);

  // Store bytes first, the row only if that succeeds. Both are inside the try: whatever reached the bucket is removed if the row never lands.
  try {
    await putObject(objectKey, body, mimeType);

    const receipt = await prisma.$transaction(async (tx) => {
      const last = await tx.receipt.aggregate({
        where: { expenseId: expense.id },
        _max: { position: true },
      });
      const created = await tx.receipt.create({
        data: {
          id: receiptId,
          position: (last._max.position ?? -1) + 1,
          expenseId: expense.id,
          objectKey,
          filename,
          mimeType,
          byteSize,
          uploadedById: uploaderId,
        },
      });
      // Quiet before the first submission; see isQuietDraftEdit.
      if (!isQuietDraftEdit(expense, uploaderId)) {
        await tx.expenseEvent.create({
          data: {
            expenseId: expense.id,
            type: "RECEIPT_UPLOADED",
            actorId: uploaderId,
          },
        });
      }
      return created;
    });
    return NextResponse.json(receipt, { status: 201 });
  } catch (err) {
    // Roll back whatever reached the bucket. Deleting a key never written is a no-op.
    await deleteObjectBestEffort(objectKey);
    throw err;
  }
}

// GET /api/expenses/:id/receipts: list a receipt's metadata (not the bytes).
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: expenseId } = await ctx.params;
  const g = await gate();
  if (!g.ok) return g.res;

  const expense = await prisma.expense.findUnique({ where: { id: expenseId } });
  if (!expense) return fail(404, "expense.notFound");

  const hidden = await denyExpenseView(g.actor, expense);
  if (hidden) return hidden;

  const receipts = await prisma.receipt.findMany({
    where: { expenseId: expense.id },
    orderBy: RECEIPT_ORDER,
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
