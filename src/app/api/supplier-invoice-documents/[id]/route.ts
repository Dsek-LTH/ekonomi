// Serve or remove one levfaktura document. The bytes stream browser ← Next ←
// storage, so every read is authorised here, and a document is only ever as
// visible as the invoice it belongs to: both handlers ask about the invoice,
// through the same loader the invoice's own routes use.
import { prisma } from "@/lib/server/db";
import { deleteObject, getObjectStream } from "@/lib/server/storage";
import { isInvoiceEditable } from "@/lib/domain/supplier-invoice";
import { fail, gate } from "@/lib/api/guard";
import { loadInvoiceFor, refuseChange } from "@/lib/api/supplier-invoice-access";

async function findDocument(id: string) {
  return prisma.supplierInvoiceDocument.findUnique({
    where: { id },
    select: { id: true, invoiceId: true, objectKey: true, filename: true },
  });
}

// GET /api/supplier-invoice-documents/:id: the file, inline.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await gate();
  if (!g.ok) return g.res;

  const doc = await findDocument(id);
  if (!doc) return fail(404, "supplierInvoice.documentNotFound");
  const access = await loadInvoiceFor(g.actor, doc.invoiceId);
  if (!access.ok) return fail(404, "supplierInvoice.documentNotFound");

  // Storage being down and an object gone missing are told apart, for the
  // reason the receipt route gives: the second is a verifikat lost.
  let obj;
  try {
    obj = await getObjectStream(doc.objectKey);
  } catch (e) {
    const name = (e as { name?: string }).name;
    if (name === "NoSuchKey" || name === "NotFound") {
      console.error(`[supplier-invoices] document ${doc.id}: object ${doc.objectKey} is gone`, e);
      return fail(404, "receipt.fileMissing");
    }
    console.error(`[supplier-invoices] document ${doc.id}: storage unreachable`, e);
    return fail(503, "receipt.storageUnavailable");
  }
  const headers = new Headers({
    "Content-Type": obj.contentType,
    // An invoice names the section's suppliers and what it pays them.
    "Cache-Control": "private, max-age=0, no-store",
    "Content-Disposition": `inline; filename="${encodeURIComponent(doc.filename)}"`,
  });
  if (obj.contentLength != null) headers.set("Content-Length", String(obj.contentLength));
  return new Response(obj.body, { headers });
}

// DELETE /api/supplier-invoice-documents/:id
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await gate();
  if (!g.ok) return g.res;

  const doc = await findDocument(id);
  if (!doc) return fail(404, "supplierInvoice.documentNotFound");
  const access = await loadInvoiceFor(g.actor, doc.invoiceId);
  if (!access.ok) return fail(404, "supplierInvoice.documentNotFound");
  const { invoice, can } = access;
  if (!can.canEditDocuments) return refuseChange(invoice, isInvoiceEditable(invoice.status));

  // Bytes first, and the row only once they are gone, for the reason the
  // receipt route gives: a file that outlives its row is one nobody can find.
  try {
    await deleteObject(doc.objectKey);
  } catch (e) {
    console.error(`[supplier-invoices] document ${doc.id}: could not delete object, keeping row`, e);
    return fail(503, "receipt.deleteStorageFailed");
  }

  await prisma.$transaction(async (tx) => {
    await tx.supplierInvoiceDocument.delete({ where: { id: doc.id } });
    await tx.supplierInvoiceEvent.create({
      data: { invoiceId: invoice.id, type: "DOCUMENT_REMOVED", actorId: g.actor.id },
    });
  });
  return new Response(null, { status: 204 });
}
