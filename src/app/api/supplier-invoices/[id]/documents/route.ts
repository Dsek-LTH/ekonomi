// Adding a document to a levfaktura: a second page that came separately, a
// specification, or the PDF itself for mail that arrived without one.
//
// The same rule as changing the rest of it (canEditDocuments): the PDF is
// what the attester signs for, so it cannot be swapped while they read it.
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { deleteObjectBestEffort, putObject, supplierInvoiceDocumentKey } from "@/lib/server/storage";
import { readDocumentUpload } from "@/lib/server/document-upload";
import { awaitsKontering } from "@/lib/domain/supplier-invoice";
import { gate } from "@/lib/api/guard";
import { loadInvoiceFor, refuseChange } from "@/lib/api/supplier-invoice-access";

// POST /api/supplier-invoices/:id/documents: multipart form-data, field "file".
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await gate();
  if (!g.ok) return g.res;

  const access = await loadInvoiceFor(g.actor, id);
  if (!access.ok) return access.res;
  const { invoice, can } = access;
  if (!can.canEditDocuments) return refuseChange(invoice, invoice.status === "INBOX" || awaitsKontering(invoice.status));

  const read = await readDocumentUpload(req);
  if (!read.ok) return read.res;
  const { doc } = read;

  const documentId = randomUUID();
  const objectKey = supplierInvoiceDocumentKey(invoice.id, documentId, doc.filename);

  try {
    await putObject(objectKey, doc.body, doc.mimeType);
    const created = await prisma.$transaction(async (tx) => {
      const last = await tx.supplierInvoiceDocument.aggregate({
        where: { invoiceId: invoice.id },
        _max: { position: true },
      });
      const row = await tx.supplierInvoiceDocument.create({
        data: {
          id: documentId,
          invoiceId: invoice.id,
          position: (last._max.position ?? -1) + 1,
          objectKey,
          filename: doc.filename,
          mimeType: doc.mimeType,
          byteSize: doc.byteSize,
          uploadedById: g.actor.id,
        },
        select: { id: true, filename: true, mimeType: true },
      });
      await tx.supplierInvoiceEvent.create({
        data: { invoiceId: invoice.id, type: "DOCUMENT_UPLOADED", actorId: g.actor.id },
      });
      return row;
    });
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    await deleteObjectBestEffort(objectKey);
    throw err;
  }
}
