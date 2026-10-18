// Receipt upload (proxy model): browser → this route → MinIO. The Next server
// authenticates, validates, stores the bytes in MinIO, and records a Receipt
// row + an audit event in Postgres. MinIO is never exposed to the browser.
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { deleteObjectBestEffort, putObject, receiptKey } from "@/lib/server/storage";
import {
  isNormalisableImage,
  normaliseImage,
  normalisedName,
} from "@/lib/server/images";
import { isEditable, isQuietDraftEdit, isRecallable } from "@/lib/domain/status";
import { SNIFF_BYTES, sniffReceiptType } from "@/lib/domain/file-type";
import { fail, gate } from "@/lib/api/guard";
import { canEditExpense, denyExpenseView } from "@/lib/api/expense-access";
import { RECEIPT_ORDER } from "@/lib/data/receipt-order";

// Generous limit on the *original* upload. Images get downscaled on the server.
const MAX_BYTES = 25 * 1024 * 1024; // 25 MB

// The multipart envelope around a 25 MB file is a little larger than the file.
// The allowance is loose on purpose: this is the cheap check that keeps an
// absurd body from being read at all, and `file.size` below is what actually
// holds the limit.
const MAX_BODY_BYTES = MAX_BYTES + 1024 * 1024;

// POST /api/expenses/:id/receipts: multipart form-data, field "file".
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: expenseId } = await ctx.params;
  const g = await gate();
  if (!g.ok) return g.res;

  const expense = await prisma.expense.findUnique({ where: { id: expenseId } });
  if (!expense) return fail(404, "expense.notFound");

  // Adding a receipt changes the utlägg, so it follows the edit rule: the
  // submitter (or an admin), and only while the utlägg is still editable.
  const hidden = await denyExpenseView(g.actor, expense);
  if (hidden) return hidden;
  if (!canEditExpense(g.actor, expense)) {
    return fail(403, "expense.noReceiptAccess");
  }
  if (!isEditable(expense.status)) {
    // Same rule as the PATCH beside it, and the same way out: swapping the
    // underlag under an attester who is reading it is the edit this closes.
    return isRecallable(expense.status)
      ? fail(409, "expense.editWhilePendingAttest")
      : fail(409, "expense.notChangeableInStatus", {
          values: { status: { key: `common.status.${expense.status}` } },
        });
  }

  // Before the body is touched. `req.formData()` reads the whole request into
  // memory, so checking `file.size` afterwards protected the bucket and not the
  // server. A 2 GB POST was buffered in full and only then called too big.
  // Content-Length is the sender's claim, which is enough here: an honest one
  // is refused for nothing, and a dishonest one still meets the real limit
  // below once the bytes are counted.
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

  // What the file *is*, from its own first bytes. `file.type` is the client's
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

  // Images are normalised (HEIC→JPEG, EXIF-rotated, downscaled, but PNG when
  // the image is see-through); PDFs are stored as-is. Work out the object to
  // write plus the row's metadata, then persist atomically (object first, row
  // second).
  //
  // One object, singular. This was an array, and every use of it a `map` over
  // exactly one element, the shape left behind when the 480px thumbnail was
  // removed and the loops around it were not.
  let filename = file.name;
  let mimeType: string = fileType;
  let byteSize = file.size;
  // Annotated, not inferred: `original` narrows to Buffer<ArrayBuffer> and the
  // normalised bytes come back as the wider Buffer, which is what putObject takes.
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

  // Store bytes first; only write the row if that succeeds (no orphan rows).
  // The write and the row are both inside the try: whatever got as far as the
  // bucket is removed on the way out if the row never lands.
  try {
    await putObject(objectKey, body, mimeType);

    const receipt = await prisma.$transaction(async (tx) => {
      // Last among the utlägg's documents. The submitter can move it from
      // there (see ./order).
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
    // Roll back whatever reached the bucket. Deleting a key that was never
    // written is a no-op, so this needs no record of which writes succeeded.
    await deleteObjectBestEffort(objectKey);
    throw err;
  }
}

// GET /api/expenses/:id/receipts: list a receipt's metadata (not the bytes).
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
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
