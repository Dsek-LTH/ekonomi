// The levfaktura Inkorg as its pages read it: every document no invoice has
// yet that the viewer may see. Not narrowed by the räkenskapsår: a document
// has no date of its own until somebody reads one off it, and one uploaded
// while another year is picked must still be there.
//
// Two readers. Triage sees all of it: what waits to be given to a unit, and
// what is with the units. A resultatansvarig sees what was given to the units
// they answer for, which is their errand: fördela it, which makes it an
// invoice, or say it is not theirs. The rule is documentCapabilities, asked
// here as a filter.
//
// Each document is the file, who sent it and when, and nothing read off it.
// What the PDF says is read when its unit opens the fördelning.
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
  /** Who put it here: the member whose mail carried it, or the uploader. */
  fromName: string | null;
  fromAddress: string | null;
  subject: string | null;
  /** What the forwarder wrote above the forwarded mail. */
  note: string | null;
  /** Who the forwarded mail was from before it was forwarded: the supplier,
   *  usually. What the fördelning's cost centre suggestion goes on. */
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

/**
 * Whether the Inkorg is the viewer's page at all: triage's, the admins', and
 * any resultatansvarig's, whose units may be given something. The role rather
 * than the units, as the frame's other links ask it.
 */
export const canSeeInvoiceInbox = (v: Pick<Viewer, "roles" | "capabilities">): boolean =>
  canTriageInvoices(v.capabilities) || isAdmin(v.capabilities) || v.roles.includes("RESULTATANSVARIG");

/** Whether the viewer sees every document, whoever it was given to. */
const seesAll = (v: InvoiceViewerCtx) => canTriageInvoices(v.capabilities) || isAdmin(v.capabilities);

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
    select: { fromName: true, fromAddress: true, subject: true, note: true, originalFrom: true, receivedAt: true },
  },
} satisfies Prisma.SupplierInvoiceDocumentSelect;

function view(v: InvoiceViewerCtx, d: Prisma.SupplierInvoiceDocumentGetPayload<{ select: typeof SELECT }>): InboxDocument {
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

/** Every document in the Inkorg the viewer may see, the oldest first: the
 *  order they are dealt with, the way any inbox is. */
export async function getInboxDocuments(viewer: Viewer): Promise<InboxDocument[]> {
  const v = await invoiceViewerOf(viewer);
  const docs = await prisma.supplierInvoiceDocument.findMany({
    where: inboxWhere(v),
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: SELECT,
  });
  return docs.map((d) => view(v, d));
}

/** One document in the Inkorg, as the viewer may see it, or null. */
export async function getInboxDocument(id: string, viewer: Viewer): Promise<InboxDocument | null> {
  const v = await invoiceViewerOf(viewer);
  const d = await prisma.supplierInvoiceDocument.findFirst({
    where: { AND: [{ id }, inboxWhere(v)] },
    select: SELECT,
  });
  return d ? view(v, d) : null;
}

/**
 * How many documents wait on the viewer, for the count beside the Inkorg's
 * link: for triage the ones nobody has been given yet, and for anyone the ones
 * given to a unit they answer for.
 */
export async function countInboxDocuments(viewer: Viewer): Promise<number> {
  const v = await invoiceViewerOf(viewer);
  const OR: Prisma.SupplierInvoiceDocumentWhereInput[] = [];
  if (canTriageInvoices(v.capabilities)) OR.push({ resultUnitId: null });
  if (v.ownedResultUnitIds.length) OR.push({ resultUnitId: { in: [...v.ownedResultUnitIds] } });
  if (OR.length === 0) return 0;
  return prisma.supplierInvoiceDocument.count({ where: { invoiceId: null, OR } });
}
