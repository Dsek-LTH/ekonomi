// Putting a levfaktura in the inkorg by hand: one PDF (or image), which becomes
// a new invoice with nothing else filled in yet.
//
// The other way in is mail forwarded to the inkorg address, which arrives
// through its own webhook. Both end in the same row: an INBOX invoice with one
// document, waiting for triage.
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { deleteObjectBestEffort, putObject, supplierInvoiceDocumentKey } from "@/lib/server/storage";
import { readDocumentUpload } from "@/lib/server/document-upload";
import { canTriageInvoices } from "@/lib/domain/permissions";
import { gate } from "@/lib/api/guard";

// POST /api/supplier-invoices: multipart form-data, field "file".
export async function POST(req: Request) {
  const g = await gate(canTriageInvoices);
  if (!g.ok) return g.res;

  const read = await readDocumentUpload(req);
  if (!read.ok) return read.res;
  const { doc } = read;

  // The ids are made here rather than by the database because the object key
  // needs them, and the bytes go to storage before either row is written.
  const invoiceId = randomUUID();
  const documentId = randomUUID();
  const objectKey = supplierInvoiceDocumentKey(invoiceId, documentId, doc.filename);

  try {
    await putObject(objectKey, doc.body, doc.mimeType);
    await prisma.supplierInvoice.create({
      data: {
        id: invoiceId,
        source: "UPLOAD",
        receivedById: g.actor.id,
        documents: {
          create: {
            id: documentId,
            objectKey,
            filename: doc.filename,
            mimeType: doc.mimeType,
            byteSize: doc.byteSize,
            uploadedById: g.actor.id,
          },
        },
        events: { create: { type: "RECEIVED", actorId: g.actor.id } },
      },
    });
  } catch (err) {
    await deleteObjectBestEffort(objectKey);
    throw err;
  }

  return NextResponse.json({ id: invoiceId }, { status: 201 });
}
