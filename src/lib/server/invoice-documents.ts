// A document moving between the Inkorg and an invoice. The one place that
// knows what that move involves, so making an invoice from a document and
// adding a document to one cannot drift apart: the document is claimed out of
// the Inkorg (still there is part of the condition, so two people cannot take
// it at once), it goes last among the invoice's documents, and what its PDF
// says fills whatever the invoice is still missing.
import "server-only";

import { getObjectBuffer } from "@/lib/server/storage";
import { prefillData, readInvoicePdf } from "@/lib/server/invoice-prefill";
import type { TxClient } from "@/lib/server/tx";

export class DocumentTaken extends Error {}

/** A document as it sits in the Inkorg, ready to move. */
export interface LooseDocument {
  id: string;
  objectKey: string;
  mimeType: string;
}

/** What the document's text gives, read before the transaction: storage and
 *  pdfjs are slow, and a transaction should not wait on either. */
export async function readLooseDocument(doc: LooseDocument) {
  const { bytes } = await getObjectBuffer(doc.objectKey);
  return readInvoicePdf(bytes, doc.mimeType);
}

/**
 * Put a document from the Inkorg on an invoice. Throws DocumentTaken when it
 * is no longer in the Inkorg, which the caller answers with a 409.
 *
 * `current` is the invoice as it stands, for the prefill to fill only what it
 * lacks.
 */
export async function attachDocument(
  tx: TxClient,
  doc: LooseDocument,
  invoice: { id: string; prefilled?: string[] } & Record<string, unknown>,
  fields: Awaited<ReturnType<typeof readLooseDocument>>,
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
      // On an invoice again, the reason it came back is history.
      returnedFrom: null,
      returnNote: null,
    },
  });
  if (count === 0) throw new DocumentTaken();

  const prefill = prefillData(invoice, fields);
  if (Object.keys(prefill).length) {
    await tx.supplierInvoice.update({ where: { id: invoice.id }, data: prefill });
  }
}
