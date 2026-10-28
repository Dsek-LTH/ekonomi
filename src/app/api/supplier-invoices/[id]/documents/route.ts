// Adding a document to a levfaktura: a specification, a corrected PDF, or the
// PDF itself for mail that arrived without one. Either a file uploaded
// straight onto it (multipart, field "file"), or one taken from the Inkorg
// (JSON, { documentId }).
//
// The same rule as changing the rest of it (canEditDocuments): the PDF is
// what the attester signs for, so it cannot be changed while they read it.
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { deleteObjectBestEffort, putObject, supplierInvoiceDocumentKey } from "@/lib/server/storage";
import { readDocumentUpload } from "@/lib/server/document-upload";
import { prefillData, readInvoicePdf } from "@/lib/server/invoice-prefill";
import { DocumentTaken, attachDocument, readLooseDocument } from "@/lib/server/invoice-documents";
import { awaitsKontering } from "@/lib/domain/supplier-invoice";
import { fail, gate } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { Id } from "@/lib/api/schemas/common";
import { loadInvoiceFor, refuseChange } from "@/lib/api/supplier-invoice-access";

const FromInbox = z.object({ documentId: Id });

// POST /api/supplier-invoices/:id/documents
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await gate();
  if (!g.ok) return g.res;

  const access = await loadInvoiceFor(g.actor, id);
  if (!access.ok) return access.res;
  const { invoice, can } = access;
  if (!can.canEditDocuments) {
    return refuseChange(invoice, awaitsKontering(invoice.status));
  }

  if (req.headers.get("content-type")?.includes("application/json")) {
    return attachFromInbox(req, invoice, g.actor.id);
  }

  const read = await readDocumentUpload(req);
  if (!read.ok) return read.res;
  const { doc } = read;

  const documentId = randomUUID();
  const objectKey = supplierInvoiceDocumentKey(invoice.id, documentId, doc.filename);
  // The PDF for a mail that came without one fills what the invoice still
  // lacks, the same as a first upload would have.
  const prefill = prefillData(invoice, await readInvoicePdf(doc.body, doc.mimeType));

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
      if (Object.keys(prefill).length) {
        await tx.supplierInvoice.update({ where: { id: invoice.id }, data: prefill });
      }
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

/** A document from the Inkorg onto this invoice. Triage's, since the Inkorg is. */
async function attachFromInbox(
  req: Request,
  invoice: { id: string; prefilled: string[] } & Record<string, unknown>,
  actorId: string,
) {
  const parsed = await parseBody(req, FromInbox);
  if (!parsed.ok) return parsed.res;
  const doc = await prisma.supplierInvoiceDocument.findUnique({
    where: { id: parsed.data.documentId },
    select: { id: true, invoiceId: true, objectKey: true, mimeType: true },
  });
  if (!doc) return fail(404, "supplierInvoice.documentNotFound");
  if (doc.invoiceId !== null) return fail(409, "supplierInvoice.documentOnInvoice");

  const fields = await readLooseDocument(doc);
  try {
    await prisma.$transaction(async (tx) => {
      await attachDocument(tx, doc, invoice, fields);
      await tx.supplierInvoiceEvent.create({
        data: { invoiceId: invoice.id, type: "DOCUMENT_ATTACHED", actorId },
      });
    });
  } catch (e) {
    if (e instanceof DocumentTaken) return fail(409, "supplierInvoice.documentOnInvoice");
    throw e;
  }
  return NextResponse.json({ id: doc.id }, { status: 201 });
}
