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

async function maySee(
  actor: Actor,
  doc: { id: string; invoiceId: string | null },
): Promise<boolean> {
  if (doc.invoiceId === null) return (await loadInboxDocumentFor(actor, doc.id)).ok;
  return (await loadInvoiceFor(actor, doc.invoiceId)).ok;
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await gate();
  if (!g.ok) return g.res;

  const doc = await findDocument(id);
  if (!doc || !(await maySee(g.actor, doc))) return fail(404, "supplierInvoice.documentNotFound");

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
    "Cache-Control": "private, max-age=0, no-store",
    "Content-Disposition": `inline; filename="${encodeURIComponent(doc.filename)}"`,
  });
  if (obj.contentLength != null) headers.set("Content-Length", String(obj.contentLength));
  return new Response(obj.body, { headers });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await gate(canTriageInvoices);
  if (!g.ok) return g.res;

  const doc = await findDocument(id);
  if (!doc) return fail(404, "supplierInvoice.documentNotFound");
  if (doc.invoiceId !== null) return fail(409, "supplierInvoice.documentOnInvoice");

  const outcome = await prisma.$transaction(async (tx) => {
    const [row] = await tx.$queryRaw<{ invoiceId: string | null }[]>`
      SELECT "invoiceId" FROM "SupplierInvoiceDocument" WHERE "id" = ${doc.id} FOR UPDATE`;
    if (!row) return "gone" as const;
    if (row.invoiceId !== null) return "attached" as const;
    try {
      await deleteObject(doc.objectKey);
    } catch (e) {
      console.error(
        `[supplier-invoices] document ${doc.id}: could not delete object, keeping row`,
        e,
      );
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
