import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { deleteObjectBestEffort, putObject, supplierInvoiceInboxKey } from "@/lib/server/storage";
import { readDocumentUpload } from "@/lib/server/document-upload";
import { canTriageInvoices } from "@/lib/domain/permissions";
import { gate } from "@/lib/api/guard";

export async function POST(req: Request) {
  const g = await gate(canTriageInvoices);
  if (!g.ok) return g.res;

  const read = await readDocumentUpload(req);
  if (!read.ok) return read.res;
  const { doc } = read;

  const documentId = randomUUID();
  const objectKey = supplierInvoiceInboxKey(documentId, doc.filename);
  try {
    await putObject(objectKey, doc.body, doc.mimeType);
    const created = await prisma.supplierInvoiceDocument.create({
      data: {
        id: documentId,
        objectKey,
        filename: doc.filename,
        mimeType: doc.mimeType,
        byteSize: doc.byteSize,
        uploadedById: g.actor.id,
      },
      select: { id: true, filename: true, mimeType: true },
    });
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    await deleteObjectBestEffort(objectKey);
    throw err;
  }
}
