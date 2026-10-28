// Taking a document off a levfaktura. It goes back to the Inkorg rather than
// away, so nothing is lost by tidying an invoice: it can be put on the right
// one from there, or deleted by somebody who has looked at it.
//
// The same rule as adding one (canEditDocuments): the PDF is what the
// attester signs for, so it is fixed once anybody has.
import { prisma } from "@/lib/server/db";
import { awaitsKontering } from "@/lib/domain/supplier-invoice";
import { fail, gate } from "@/lib/api/guard";
import { loadInvoiceFor, refuseChange } from "@/lib/api/supplier-invoice-access";

// POST /api/supplier-invoice-documents/:id/detach
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await gate();
  if (!g.ok) return g.res;

  const doc = await prisma.supplierInvoiceDocument.findUnique({
    where: { id },
    select: { id: true, invoiceId: true },
  });
  if (!doc) return fail(404, "supplierInvoice.documentNotFound");
  if (doc.invoiceId === null) return fail(409, "supplierInvoice.documentNotOnInvoice");

  const access = await loadInvoiceFor(g.actor, doc.invoiceId);
  if (!access.ok) return fail(404, "supplierInvoice.documentNotFound");
  const { invoice, can } = access;
  if (!can.canEditDocuments) {
    return refuseChange(invoice, awaitsKontering(invoice.status));
  }

  const moved = await prisma.$transaction(async (tx) => {
    // Still on this invoice is part of the condition.
    const { count } = await tx.supplierInvoiceDocument.updateMany({
      where: { id: doc.id, invoiceId: invoice.id },
      data: { invoiceId: null, position: 0 },
    });
    if (count === 0) return false;
    await tx.supplierInvoiceEvent.create({
      data: { invoiceId: invoice.id, type: "DOCUMENT_REMOVED", actorId: g.actor.id },
    });
    return true;
  });
  if (!moved) return fail(409, "supplierInvoice.changedMeanwhile");
  return new Response(null, { status: 204 });
}
