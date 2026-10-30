// Making a levfaktura: a document in a unit's Inkorg, fördelad by that unit.
// The fördelning is what makes it an invoice. Until a unit has said which of
// its cost centres take it, it is a document that may still turn out to be
// somebody else's, and nothing is owed on it that anybody has signed for.
//
// The fördelning is the one a reopened invoice is given again through its
// transition (`attest`), planned the same way (planAllocation): the rows the
// sender may sign are signed as it is made, and only a split onto another
// unit's cost centre waits, in PENDING_APPROVAL, for that unit. The PDF is
// read here too, as the page that sent this read it, and what it says fills
// the rest of the invoice for the treasury to check.
//
// The invoice's history starts with what the document went through: when it
// arrived and who gave it to the unit, dated as they happened.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { deliverSoon, notify } from "@/lib/server/notify";
import { invoiceNotice } from "@/lib/email/content";
import { isoToDate, today } from "@/lib/domain/date";
import { readDocumentScan } from "@/lib/server/invoice-documents";
import { prefillData } from "@/lib/server/invoice-prefill";
import { planAllocation } from "@/lib/server/invoice-allocation";
import { fail, gate } from "@/lib/api/guard";
import { denyOutsideFiscalYear } from "@/lib/api/fiscal-year";
import { applied, commit } from "@/lib/api/stale-write";
import { parseBody } from "@/lib/api/parse";
import { CreateSupplierInvoice } from "@/lib/api/schemas/supplier-invoice";
import { loadInboxDocumentFor } from "@/lib/api/supplier-invoice-access";
import { claimInvoiceReference, withReferenceRetry } from "@/lib/server/expense-reference";

// POST /api/supplier-invoices: { documentId, rows, amount, dueDate, description?, comment? }
export async function POST(req: Request) {
  const g = await gate();
  if (!g.ok) return g.res;
  const actor = g.actor;

  const parsed = await parseBody(req, CreateSupplierInvoice);
  if (!parsed.ok) return parsed.res;
  const { documentId, rows, amount, dueDate, description, comment } = parsed.data;

  const access = await loadInboxDocumentFor(actor, documentId);
  if (!access.ok) return access.res;
  const { doc, viewer, can } = access;
  if (!can.canAllocate || !doc.resultUnit) {
    // Not given to a unit is the document's state; not theirs is the actor.
    return doc.resultUnit
      ? fail(403, "supplierInvoice.denied")
      : fail(409, "supplierInvoice.documentNotAssigned");
  }
  const unit = doc.resultUnit;

  const planning = await planAllocation({ rows, total: amount, documentCount: 1, viewer, actorId: actor.id });
  if (!planning.ok) return planning.res;
  const { planned, signed, status, attesters } = planning.plan;

  // What the PDF says fills what the unit did not type, for the treasury to
  // check. Read before the transaction, since storage and the PDF reader are
  // slow; the page that sent this has read it already, so it is usually kept.
  const reading = await readDocumentScan(doc.id);
  const typed = { amount, dueDate: isoToDate(dueDate), description: description ?? null };
  const filled = prefillData(typed, reading.fields, reading.supplier);
  const prefilled = ((filled.prefilled as string[] | undefined) ?? []).filter(
    (f) => f !== "amount" && f !== "dueDate",
  );

  // Dated by what the invoice says, or by today for one that says nothing
  // readable, which has to be in the year picked in the header for it to be
  // in the Fakturor list it is looked for in.
  const offYear = await denyOutsideFiscalYear((filled.invoiceDate as Date | undefined) ?? today());
  if (offYear) return offYear;

  const receivedAt = doc.inboundMail?.receivedAt ?? doc.createdAt;
  const receivedById = doc.inboundMail ? doc.inboundMail.senderId : doc.uploadedById;

  const result = await commit(() =>
    withReferenceRetry(() =>
      prisma.$transaction(async (tx) => {
        const invoice = await tx.supplierInvoice.create({
          data: {
            ...filled,
            ...typed,
            prefilled,
            reference: await claimInvoiceReference(tx),
            source: doc.inboundMail ? "EMAIL" : "UPLOAD",
            status,
            receivedById,
            inboundMailId: doc.inboundMail?.id ?? null,
            resultUnitId: unit.id,
            assignedById: doc.assignedById,
            assignedAt: doc.assignedAt,
            allocations: { create: planned.map((p) => p.data) },
            events: {
              create: [
                { type: "RECEIVED", actorId: receivedById, createdAt: receivedAt },
                {
                  type: "ASSIGNED",
                  actorId: doc.assignedById,
                  diff: { from: null, to: unit.name },
                  createdAt: doc.assignedAt ?? receivedAt,
                },
                ...(signed.length
                  ? [{ type: "COST_CENTER_APPROVED" as const, actorId: actor.id, comment: comment ?? null, diff: { costCenters: signed } }]
                  : []),
                ...(status === "APPROVED" ? [{ type: "APPROVED" as const, actorId: actor.id }] : []),
              ],
            },
          },
          include: { allocations: { include: { costCenter: { select: { code: true, name: true } } } } },
        });
        // Still in that unit's Inkorg is part of the condition: fördelad in
        // another tab a moment ago, or given elsewhere, it is not this
        // request's to make an invoice of.
        applied(
          await tx.supplierInvoiceDocument.updateMany({
            where: { id: doc.id, invoiceId: null, resultUnitId: unit.id },
            data: {
              invoiceId: invoice.id,
              position: 0,
              resultUnitId: null,
              assignedById: null,
              assignedAt: null,
              returnedFrom: null,
              returnNote: null,
            },
          }),
          "supplierInvoice.changedMeanwhile",
        );
        if (attesters.length) {
          await notify(
            tx,
            "SUPPLIER_INVOICE_SUBMITTED",
            attesters,
            invoiceNotice(
              "submitted",
              invoice,
              { actor: actor.name, unit: unit.name },
              { author: actor.name, text: comment || null },
            ),
            { exclude: [actor.id] },
          );
        }
        return invoice;
      }),
    ),
  );
  if (result instanceof NextResponse) return result;
  deliverSoon();
  return NextResponse.json({ id: result.id, status: result.status }, { status: 201 });
}
