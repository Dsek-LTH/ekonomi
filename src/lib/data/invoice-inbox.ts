// Every document no invoice has yet: the Inkorg, which is triage's (and the admins', to look at). Not narrowed by
// räkenskapsår: a document has no date until one is read off it.
import "server-only";

import { prisma } from "@/lib/server/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { canTriageInvoices } from "@/lib/domain/permissions";
import { documentCapabilities, type DocumentCapabilities } from "@/lib/domain/supplier-invoice";
import type { Viewer } from "./expense-scope";

export interface InboxDocument {
  id: string;
  filename: string;
  mimeType: string;
  receivedAt: string; // ISO
  fromName: string | null;
  fromAddress: string | null;
  subject: string | null;
  note: string | null;
  /** Whether it came by mail, so there is a mail to read beside it. */
  mailed: boolean;
  /** For one sent back with its invoice: which unit, and why. */
  returned: { from: string | null; reason: string } | null;
  can: DocumentCapabilities;
}

/** Whether the Inkorg is the viewer's page at all: triage and the admins. */
export const canSeeInvoiceInbox = (v: Pick<Viewer, "capabilities">): boolean =>
  documentCapabilities(v).canSee;

const SELECT = {
  id: true,
  filename: true,
  mimeType: true,
  createdAt: true,
  returnedFrom: true,
  returnNote: true,
  uploadedBy: { select: { name: true } },
  inboundMail: {
    select: {
      fromName: true,
      fromAddress: true,
      subject: true,
      note: true,
      receivedAt: true,
    },
  },
} satisfies Prisma.SupplierInvoiceDocumentSelect;

function view(
  can: DocumentCapabilities,
  d: Prisma.SupplierInvoiceDocumentGetPayload<{ select: typeof SELECT }>,
): InboxDocument {
  return {
    id: d.id,
    filename: d.filename,
    mimeType: d.mimeType,
    receivedAt: (d.inboundMail?.receivedAt ?? d.createdAt).toISOString(),
    fromName: d.inboundMail?.fromName ?? d.uploadedBy?.name ?? null,
    fromAddress: d.inboundMail?.fromAddress ?? null,
    subject: d.inboundMail?.subject ?? null,
    note: d.inboundMail?.note ?? null,
    mailed: d.inboundMail !== null,
    returned: d.returnNote ? { from: d.returnedFrom, reason: d.returnNote } : null,
    can,
  };
}

export async function getInboxDocuments(viewer: Viewer): Promise<InboxDocument[]> {
  const can = documentCapabilities(viewer);
  if (!can.canSee) return [];
  const docs = await prisma.supplierInvoiceDocument.findMany({
    where: { invoiceId: null },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: SELECT,
  });
  return docs.map((d) => view(can, d));
}

/** Documents waiting for triage to give them to a unit. */
export async function countInboxDocuments(viewer: Viewer): Promise<number> {
  if (!canTriageInvoices(viewer.capabilities)) return 0;
  return prisma.supplierInvoiceDocument.count({ where: { invoiceId: null } });
}

/** The mail one document in the Inkorg came in, to read in full. Null for an upload, or for somebody who may not see it. */
export async function getInboxMail(
  documentId: string,
  viewer: Viewer,
): Promise<{ body: string | null } | null> {
  if (!documentCapabilities(viewer).canSee) return null;
  const doc = await prisma.supplierInvoiceDocument.findFirst({
    where: { id: documentId, invoiceId: null },
    select: { inboundMail: { select: { body: true } } },
  });
  return doc?.inboundMail ?? null;
}
