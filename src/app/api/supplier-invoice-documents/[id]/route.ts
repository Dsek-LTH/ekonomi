// Serve one levfaktura document, or delete one from the Inkorg. The bytes
// stream browser ← Next ← storage, so every read is authorised here.
//
// A document on an invoice is as visible as the invoice, asked through the
// same loader the invoice's own routes use. One in the Inkorg belongs to no
// invoice yet: it is triage's, and once given to a unit, that unit's too.
//
// Deleting is only ever from the Inkorg. A document on an invoice stays on it:
// it is the underlag the invoice is attested and booked on, so there is no
// taking it off. It goes back to the Inkorg only with the whole invoice, when
// that is sent back (supplier-invoices/[id]/return).
import { prisma } from "@/lib/server/db";
import { deleteObject, getObjectStream } from "@/lib/server/storage";
import { canTriageInvoices } from "@/lib/domain/permissions";
import { fail, gate, type Actor } from "@/lib/api/guard";
import { loadInboxDocumentFor, loadInvoiceFor } from "@/lib/api/supplier-invoice-access";

async function findDocument(id: string) {
  return prisma.supplierInvoiceDocument.findUnique({
    where: { id },
    select: { id: true, invoiceId: true, objectKey: true, filename: true },
  });
}

/** Whether the actor may see this document at all. */
async function maySee(actor: Actor, doc: { id: string; invoiceId: string | null }): Promise<boolean> {
  if (doc.invoiceId === null) return (await loadInboxDocumentFor(actor, doc.id)).ok;
  return (await loadInvoiceFor(actor, doc.invoiceId)).ok;
}

// GET /api/supplier-invoice-documents/:id: the file, inline.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await gate();
  if (!g.ok) return g.res;

  const doc = await findDocument(id);
  if (!doc || !(await maySee(g.actor, doc))) return fail(404, "supplierInvoice.documentNotFound");

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

// DELETE /api/supplier-invoice-documents/:id: from the Inkorg, for good.
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await gate(canTriageInvoices);
  if (!g.ok) return g.res;

  const doc = await findDocument(id);
  if (!doc) return fail(404, "supplierInvoice.documentNotFound");
  if (doc.invoiceId !== null) return fail(409, "supplierInvoice.documentOnInvoice");

  // The row is held while it goes, so it cannot be attached to an invoice
  // between the check and the delete: attached in another tab a moment ago, it
  // is an invoice's now and not this request's to delete. Bytes first, and the
  // row only once they are gone, for the reason the receipt route gives: a
  // file that outlives its row is one nobody can find.
  const outcome = await prisma.$transaction(async (tx) => {
    const [row] = await tx.$queryRaw<{ invoiceId: string | null }[]>`
      SELECT "invoiceId" FROM "SupplierInvoiceDocument" WHERE "id" = ${doc.id} FOR UPDATE`;
    if (!row) return "gone" as const;
    if (row.invoiceId !== null) return "attached" as const;
    try {
      await deleteObject(doc.objectKey);
    } catch (e) {
      console.error(`[supplier-invoices] document ${doc.id}: could not delete object, keeping row`, e);
      return "storage" as const;
    }
    await tx.supplierInvoiceDocument.delete({ where: { id: doc.id } });
    return "deleted" as const;
  });
  if (outcome === "gone") return fail(404, "supplierInvoice.documentNotFound");
  if (outcome === "attached") return fail(409, "supplierInvoice.documentOnInvoice");
  if (outcome === "storage") return fail(503, "receipt.deleteStorageFailed");
  return new Response(null, { status: 204 });
}
