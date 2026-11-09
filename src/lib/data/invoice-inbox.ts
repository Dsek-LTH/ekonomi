// Every document no invoice has yet that the viewer may see. Not narrowed by räkenskapsår: a
// document has no date until one is read off it. Triage sees all; a resultatansvarig sees what
// was given to their units (rule: documentCapabilities).
import "server-only";

import { prisma } from "@/lib/server/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { canTriageInvoices, isAdmin } from "@/lib/domain/permissions";
import { documentCapabilities, type DocumentCapabilities } from "@/lib/domain/supplier-invoice";
import { invoiceViewerOf, type InvoiceViewerCtx } from "./supplier-invoices";
import type { Viewer } from "./expense-scope";
import { isoDate } from "./shared";

export interface InboxDocument {
  id: string;
  filename: string;
  mimeType: string;
  receivedAt: string; // ISO
  fromName: string | null;
  fromAddress: string | null;
  subject: string | null;
  note: string | null;
  /** Who the forwarded mail was from, usually the supplier. Basis for the cost centre suggestion. */
  originalFrom: string | null;
  /** YYYY-MM-DD, as triage entered it when sending it to a unit, or "". */
  dueDate: string;
  /** The unit whose Inkorg it is in, or null while it waits for triage. */
  resultUnitId: string | null;
  resultUnitName: string | null;
  /** For one sent back by a unit, or with its invoice: which unit, and why. */
  returned: { from: string | null; reason: string } | null;
  can: DocumentCapabilities;
}

/** Whether the Inkorg is the viewer's page at all: triage, admins, any resultatansvarig. */
export const canSeeInvoiceInbox = (v: Pick<Viewer, "roles" | "capabilities">): boolean =>
  canTriageInvoices(v.capabilities) ||
  isAdmin(v.capabilities) ||
  v.roles.includes("RESULTATANSVARIG");

const seesAll = (v: InvoiceViewerCtx) =>
  canTriageInvoices(v.capabilities) || isAdmin(v.capabilities);

function inboxWhere(v: InvoiceViewerCtx): Prisma.SupplierInvoiceDocumentWhereInput {
  if (seesAll(v)) return { invoiceId: null };
  return { invoiceId: null, resultUnitId: { in: [...v.ownedResultUnitIds] } };
}

const SELECT = {
  id: true,
  filename: true,
  mimeType: true,
  createdAt: true,
  dueDate: true,
  resultUnitId: true,
  returnedFrom: true,
  returnNote: true,
  resultUnit: { select: { name: true } },
  uploadedBy: { select: { name: true } },
  inboundMail: {
    select: {
      fromName: true,
      fromAddress: true,
      subject: true,
      note: true,
      originalFrom: true,
      receivedAt: true,
    },
  },
} satisfies Prisma.SupplierInvoiceDocumentSelect;

function view(
  v: InvoiceViewerCtx,
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
    originalFrom: d.inboundMail?.originalFrom ?? null,
    dueDate: isoDate(d.dueDate),
    resultUnitId: d.resultUnitId,
    resultUnitName: d.resultUnit?.name ?? null,
    returned: d.returnNote ? { from: d.returnedFrom, reason: d.returnNote } : null,
    can: documentCapabilities(v, d),
  };
}

export async function getInboxDocuments(viewer: Viewer): Promise<InboxDocument[]> {
  const v = await invoiceViewerOf(viewer);
  const docs = await prisma.supplierInvoiceDocument.findMany({
    where: inboxWhere(v),
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: SELECT,
  });
  return docs.map((d) => view(v, d));
}

export async function getInboxDocument(id: string, viewer: Viewer): Promise<InboxDocument | null> {
  const v = await invoiceViewerOf(viewer);
  const d = await prisma.supplierInvoiceDocument.findFirst({
    where: { AND: [{ id }, inboxWhere(v)] },
    select: SELECT,
  });
  return d ? view(v, d) : null;
}

/** Documents waiting on the viewer: for triage those nobody has been given, for anyone those given to their units. */
export async function countInboxDocuments(viewer: Viewer): Promise<number> {
  const v = await invoiceViewerOf(viewer);
  const OR: Prisma.SupplierInvoiceDocumentWhereInput[] = [];
  if (canTriageInvoices(v.capabilities)) OR.push({ resultUnitId: null });
  if (v.ownedResultUnitIds.length) OR.push({ resultUnitId: { in: [...v.ownedResultUnitIds] } });
  if (OR.length === 0) return 0;
  return prisma.supplierInvoiceDocument.count({ where: { invoiceId: null, OR } });
}
