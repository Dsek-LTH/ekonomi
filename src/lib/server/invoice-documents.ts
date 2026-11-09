// A document moving between the Inkorg and an invoice, and what its PDF says. The document is claimed out of
// the Inkorg (still being there is part of the condition) and goes last among the invoice's documents.
import "server-only";

import { prisma } from "@/lib/server/db";
import { getObjectBuffer } from "@/lib/server/storage";
import { readInvoicePdf } from "@/lib/server/invoice-prefill";
import { supplierMatcher, type KnownSupplier } from "@/lib/server/supplier-register";
import type { InvoiceTextFields } from "@/lib/domain/invoice-text";
import type { TxClient } from "@/lib/server/tx";

export class DocumentTaken extends Error {}

/** A document as it sits in the Inkorg, ready to move. */
export interface LooseDocument {
  id: string;
  objectKey: string;
  mimeType: string;
  scan: unknown;
  scannedAt: Date | null;
}

/** What an invoice's documents gave, and who that says it is from. */
export interface DocumentReading {
  fields: InvoiceTextFields;
  supplier: KnownSupplier | null;
}

/** What the PDF's text layer says, as kept on the document, or read now. */
export async function scanOf(doc: LooseDocument): Promise<InvoiceTextFields> {
  if (doc.scannedAt) return (doc.scan ?? {}) as InvoiceTextFields;
  const { bytes } = await getObjectBuffer(doc.objectKey);
  return readInvoicePdf(bytes, doc.mimeType);
}

/** What an invoice's documents say, read now for any not read before. The first document to say a thing is believed. Best effort. */
export const readInvoiceScan = (invoiceId: string) => readScan({ invoiceId });

/** The same for one document in a unit's Inkorg, before it is an invoice. */
export const readDocumentScan = (documentId: string) => readScan({ id: documentId });

async function readScan(where: { invoiceId: string } | { id: string }): Promise<DocumentReading> {
  const docs = await prisma.supplierInvoiceDocument.findMany({
    where,
    orderBy: [{ position: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    select: { id: true, objectKey: true, mimeType: true, scan: true, scannedAt: true },
  });
  const scans = await Promise.all(
    docs.map(async (d) => {
      if (d.scannedAt) return (d.scan ?? {}) as InvoiceTextFields;
      try {
        const scan = await scanOf(d);
        await prisma.supplierInvoiceDocument.update({
          where: { id: d.id },
          data: { scan: { ...scan }, scannedAt: new Date() },
        });
        return scan;
      } catch (err) {
        console.warn("[supplier-invoices] could not read document", d.id, err);
        return {};
      }
    }),
  );
  const fields: InvoiceTextFields = {};
  for (const scan of scans) {
    for (const [k, v] of Object.entries(scan) as [keyof InvoiceTextFields, never][]) {
      if (v !== undefined && fields[k] === undefined) fields[k] = v;
    }
  }
  const match = await supplierMatcher();
  return { fields, supplier: match(fields) };
}

/** Put a document from the Inkorg on an invoice. Throws DocumentTaken when it is no longer in the Inkorg (caller answers 409). */
export async function attachDocument(
  tx: TxClient,
  doc: { id: string },
  invoice: { id: string },
): Promise<void> {
  const last = await tx.supplierInvoiceDocument.aggregate({
    where: { invoiceId: invoice.id },
    _max: { position: true },
  });
  const { count } = await tx.supplierInvoiceDocument.updateMany({
    where: { id: doc.id, invoiceId: null },
    data: {
      invoiceId: invoice.id,
      position: (last._max.position ?? -1) + 1,
      // On an invoice, the unit is the invoice's.
      resultUnitId: null,
      assignedById: null,
      assignedAt: null,
      returnedFrom: null,
      returnNote: null,
    },
  });
  if (count === 0) throw new DocumentTaken();
}
