// The levfaktura Inkorg as its page reads it: every document no invoice has
// yet.
//
// Triage's alone, which the page and the routes check. Nothing here narrows
// by viewer, because whoever is allowed to look sees all of it.
import "server-only";

import { prisma } from "@/lib/server/db";
import type { During } from "@/lib/server/fiscal-year";

export interface InboxDocument {
  id: string;
  filename: string;
  mimeType: string;
  receivedAt: string; // ISO
  /** Who put it here: the member whose mail carried it, or the uploader. */
  fromName: string | null;
  fromAddress: string | null;
  subject: string | null;
  /** What the forwarder wrote above the forwarded mail. */
  note: string | null;
  /** For one sent back from an invoice: the unit it came back from, and why. */
  returned: { from: string | null; reason: string } | null;
}

/** What the räkenskapsår asks of an Inkorg document: when it arrived, the only
 *  date it has before anybody has read one off it. See docs/navigation.md. */
const arrivedDuring = (during?: During) => (during ? { createdAt: during } : {});

/** Every document in the Inkorg, the oldest first: the order they are dealt
 *  with, the way any inbox is. */
export async function getInboxDocuments({ during }: { during?: During } = {}): Promise<InboxDocument[]> {
  const docs = await prisma.supplierInvoiceDocument.findMany({
    where: { invoiceId: null, ...arrivedDuring(during) },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      filename: true,
      mimeType: true,
      createdAt: true,
      returnedFrom: true,
      returnNote: true,
      uploadedBy: { select: { name: true } },
      inboundMail: {
        select: { fromName: true, fromAddress: true, subject: true, note: true, receivedAt: true },
      },
    },
  });
  return docs.map((d) => ({
    id: d.id,
    filename: d.filename,
    mimeType: d.mimeType,
    receivedAt: (d.inboundMail?.receivedAt ?? d.createdAt).toISOString(),
    fromName: d.inboundMail?.fromName ?? d.uploadedBy?.name ?? null,
    fromAddress: d.inboundMail?.fromAddress ?? null,
    subject: d.inboundMail?.subject ?? null,
    note: d.inboundMail?.note ?? null,
    returned: d.returnNote ? { from: d.returnedFrom, reason: d.returnNote } : null,
  }));
}

/** How many documents wait in the Inkorg, for the count beside its link. */
export const countInboxDocuments = ({ during }: { during?: During } = {}) =>
  prisma.supplierInvoiceDocument.count({ where: { invoiceId: null, ...arrivedDuring(during) } });
