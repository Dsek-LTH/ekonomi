// Making a levfaktura from a document in the Inkorg, and giving it to a result
// unit in the same step. The document becomes the new invoice's first, what its
// PDF says fills the invoice's fields, and the unit's resultatansvarig is told.
//
// The unit is required. Making an invoice is deciding whose it is: a document
// whose unit is not known yet stays in the Inkorg until it is, rather than
// becoming an invoice that waits for the same decision somewhere else.
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { DocumentTaken, attachDocument, readLooseDocument } from "@/lib/server/invoice-documents";
import { deliverSoon, notify } from "@/lib/server/notify";
import { invoiceNotice } from "@/lib/email/content";
import { canTriageInvoices } from "@/lib/domain/permissions";
import { cleanSubject } from "@/lib/domain/inbound-mail";
import { fail, gate } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { Id } from "@/lib/api/schemas/common";
import { unitOwnersOf } from "@/lib/api/supplier-invoice-access";

const CreateInvoice = z.object({ documentId: Id, resultUnitId: Id });

// POST /api/supplier-invoices: { documentId, resultUnitId }
export async function POST(req: Request) {
  const g = await gate(canTriageInvoices);
  if (!g.ok) return g.res;

  const parsed = await parseBody(req, CreateInvoice);
  if (!parsed.ok) return parsed.res;

  const [doc, unit] = await Promise.all([
    prisma.supplierInvoiceDocument.findUnique({
      where: { id: parsed.data.documentId },
      select: {
        id: true,
        invoiceId: true,
        objectKey: true,
        mimeType: true,
        uploadedById: true,
        inboundMail: { select: { id: true, senderId: true, subject: true } },
      },
    }),
    prisma.resultUnit.findUnique({ where: { id: parsed.data.resultUnitId }, select: { id: true, name: true } }),
  ]);
  if (!doc) return fail(404, "supplierInvoice.documentNotFound");
  if (doc.invoiceId !== null) return fail(409, "supplierInvoice.documentOnInvoice");
  if (!unit) return fail(422, "supplierInvoice.unknownResultUnit");

  const [fields, owners] = await Promise.all([readLooseDocument(doc), unitOwnersOf(unit.name)]);
  // Whoever it came from: the member whose mail carried it, or the uploader.
  const receivedById = doc.inboundMail ? doc.inboundMail.senderId : doc.uploadedById;
  const description = cleanSubject(doc.inboundMail?.subject);

  try {
    const id = await prisma.$transaction(async (tx) => {
      const invoice = await tx.supplierInvoice.create({
        data: {
          source: doc.inboundMail ? "EMAIL" : "UPLOAD",
          status: "ASSIGNED",
          receivedById,
          inboundMailId: doc.inboundMail?.id ?? null,
          description,
          resultUnitId: unit.id,
          assignedById: g.actor.id,
          assignedAt: new Date(),
          events: {
            create: [
              { type: "RECEIVED", actorId: g.actor.id },
              { type: "ASSIGNED", actorId: g.actor.id, diff: { from: null, to: unit.name } },
            ],
          },
        },
      });
      await attachDocument(tx, doc, invoice, fields);
      await notify(
        tx,
        "SUPPLIER_INVOICE_ASSIGNED",
        owners,
        invoiceNotice(
          "assigned",
          { id: invoice.id, supplierName: null, invoiceNumber: null, description, amount: null, dueDate: null },
          { actor: g.actor.name, unit: unit.name },
        ),
        { exclude: [g.actor.id] },
      );
      return invoice.id;
    });
    deliverSoon();
    return NextResponse.json({ id }, { status: 201 });
  } catch (e) {
    if (e instanceof DocumentTaken) return fail(409, "supplierInvoice.documentOnInvoice");
    throw e;
  }
}
