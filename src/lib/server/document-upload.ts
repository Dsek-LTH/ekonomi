// Reading one uploaded document off a multipart request: the size limits, what
// the file actually is, and the image normalisation, before anything is stored.
//
// The same checks the receipt upload makes (api/expenses/[id]/receipts), in the
// same order and for the same reasons, which are written out there. Pulled out
// here for the levfaktura routes, which take a document the same way and have
// no reason to judge one differently.
import "server-only";

import type { NextResponse } from "next/server";
import { fail } from "@/lib/api/guard";
import { SNIFF_BYTES, sniffReceiptType } from "@/lib/domain/file-type";
import { isNormalisableImage, normaliseImage, normalisedName } from "@/lib/server/images";

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB
const MAX_BODY_BYTES = MAX_BYTES + 1024 * 1024;

export interface ReadDocument {
  body: Buffer;
  filename: string;
  mimeType: string;
  byteSize: number;
}

/**
 * The file in the form's "file" field, ready to store, or the response that
 * says why not. Images come back normalised (rotated, downscaled, HEIC made
 * JPEG); a PDF comes back exactly as sent.
 */
export async function readDocumentUpload(
  req: Request,
): Promise<{ ok: true; doc: ReadDocument } | { ok: false; res: NextResponse }> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return { ok: false, res: fail(413, "receipt.sizeRange", { values: { max: MAX_BYTES } }) };
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return { ok: false, res: fail(400, "request.expectedMultipart") };
  }

  const file = form.get("file");
  if (!(file instanceof File)) return { ok: false, res: fail(400, "request.noFile") };
  if (file.size === 0 || file.size > MAX_BYTES) {
    return { ok: false, res: fail(413, "receipt.sizeRange", { values: { max: MAX_BYTES } }) };
  }

  const head = new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer());
  const fileType = sniffReceiptType(head);
  if (!fileType) {
    return {
      ok: false,
      res: fail(415, "receipt.unsupportedType", { values: { type: file.type || "?" } }),
    };
  }

  const original = Buffer.from(await file.arrayBuffer());
  if (!isNormalisableImage(fileType)) {
    return {
      ok: true,
      doc: { body: original, filename: file.name, mimeType: fileType, byteSize: file.size },
    };
  }

  let normalised;
  try {
    normalised = await normaliseImage(original);
  } catch {
    return { ok: false, res: fail(422, "receipt.unreadable") };
  }
  return {
    ok: true,
    doc: {
      body: normalised.full,
      filename: normalisedName(file.name, normalised.mimeType),
      mimeType: normalised.mimeType,
      byteSize: normalised.full.length,
    },
  };
}
