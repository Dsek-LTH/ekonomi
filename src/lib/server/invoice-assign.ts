// Giving a document from the Inkorg to a unit, which is what makes the levfaktura. Triage does it from the Inkorg
// (api/supplier-invoice-documents/[id]/assign), and the mail intake does it when the forwarder's note settles the unit
// (lib/server/inbound-mail.ts). The invoice starts ASSIGNED, waiting for the unit to fördela it, with its history from
// when the document arrived.
import "server-only";

import type { TxClient } from "@/lib/server/tx";
import { notify } from "@/lib/server/notify";
import { invoiceNotice } from "@/lib/email/content";
import { cleanSubject } from "@/lib/domain/inbound-mail";
import { claimInvoiceReference } from "@/lib/server/expense-reference";
import { applied } from "@/lib/api/stale-write";
import { unitOwnersOf } from "@/lib/api/supplier-invoice-access";

export interface AssignableDocument {
  id: string;
  createdAt: Date;
  uploadedById: string | null;
  inboundMail: {
    id: string;
    senderId: string | null;
    receivedAt: Date;
    subject: string | null;
  } | null;
}

/**
 * Make the invoice for `doc`, given to `unit`, and mail the unit's owners. Must run inside the transaction that
 * takes the reference, wrapped in `withReferenceRetry`. A document no longer in the Inkorg throws StaleWrite.
 */
export async function assignDocument(
  tx: TxClient,
  {
    doc,
    unit,
    actor,
    dueDate,
    note,
    forwarderId,
  }: {
    doc: AssignableDocument;
    unit: { id: string; name: string };
    /** Who gave it, or null for the mail intake. `name` is who the mail says gave it. */
    actor: { id: string | null; name: string };
    dueDate: Date | null;
    /** What the forwarder wrote, shown in the mail to the unit. */
    note?: { author: string; text: string } | null;
    /** The member whose mail it came in, who knows already and is not mailed. */
    forwarderId?: string | null;
  },
): Promise<{ id: string }> {
  const receivedAt = doc.inboundMail?.receivedAt ?? doc.createdAt;
  const receivedById = doc.inboundMail ? doc.inboundMail.senderId : doc.uploadedById;
  const now = new Date();

  const invoice = await tx.supplierInvoice.create({
    data: {
      reference: await claimInvoiceReference(tx),
      status: "ASSIGNED",
      source: doc.inboundMail ? "EMAIL" : "UPLOAD",
      receivedById,
      inboundMailId: doc.inboundMail?.id ?? null,
      resultUnitId: unit.id,
      assignedById: actor.id,
      assignedAt: now,
      dueDate,
      events: {
        create: [
          { type: "RECEIVED", actorId: receivedById, createdAt: receivedAt },
          { type: "ASSIGNED", actorId: actor.id, diff: { from: null, to: unit.name } },
        ],
      },
    },
    select: {
      id: true,
      reference: true,
      supplierName: true,
      invoiceNumber: true,
      amount: true,
      dueDate: true,
    },
  });
  // Still in the Inkorg is part of the condition: given or deleted a moment ago, it is not this request's to give.
  applied(
    await tx.supplierInvoiceDocument.updateMany({
      where: { id: doc.id, invoiceId: null },
      data: { invoiceId: invoice.id, position: 0, returnedFrom: null, returnNote: null },
    }),
    "supplierInvoice.changedMeanwhile",
  );

  const owners = await unitOwnersOf(unit.name);
  await notify(
    tx,
    "SUPPLIER_INVOICE_ASSIGNED",
    owners,
    invoiceNotice(
      "assigned",
      // Named in the mail by what the forwarded mail was about, since nobody has said what it is for yet.
      { ...invoice, description: cleanSubject(doc.inboundMail?.subject) ?? null },
      { actor: actor.name, unit: unit.name },
      note ?? undefined,
    ),
    { exclude: [actor.id, forwarderId] },
  );
  return { id: invoice.id };
}
