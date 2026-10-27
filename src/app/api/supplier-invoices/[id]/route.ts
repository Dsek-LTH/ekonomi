// One levfaktura: the treasurer's details on it, and deleting it.
//
// The details (supplier, amount, dates, OCR, the account on each row) are the
// treasurer's to complete, at any point until it is in Fortnox
// (canEditDetails). The kontering is not changed here: that is the attest's,
// and is sent with it (./transition).
import { prisma } from "@/lib/server/db";
import { deleteObject } from "@/lib/server/storage";
import { isInvoiceDeletable } from "@/lib/domain/supplier-invoice";
import { isoToDate } from "@/lib/domain/date";
import { fail, gate } from "@/lib/api/guard";
import { applied, commit } from "@/lib/api/stale-write";
import { parseBody } from "@/lib/api/parse";
import { PatchSupplierInvoice } from "@/lib/api/schemas/supplier-invoice";
import { loadInvoiceFor, refuseChange } from "@/lib/api/supplier-invoice-access";
import { isoDate } from "@/lib/data/shared";

// The free-text columns, which are copied across as they arrive.
const TEXT_FIELDS = [
  "description",
  "supplierName",
  "supplierOrgNo",
  "invoiceNumber",
  "ocr",
  "bankgiro",
  "plusgiro",
] as const;

// PATCH /api/supplier-invoices/:id
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await gate();
  if (!g.ok) return g.res;

  const parsed = await parseBody(req, PatchSupplierInvoice);
  if (!parsed.ok) return parsed.res;
  const body = parsed.data;

  const access = await loadInvoiceFor(g.actor, id);
  if (!access.ok) return access.res;
  const { invoice, can } = access;
  if (!can.canEditDetails) return refuseChange(invoice, invoice.status !== "EXPORTED");

  // What changed, by field name, for the history. The values themselves are
  // on the invoice, and a log of every keystroke's worth of old text says less
  // than the one line "Leverantör, belopp ändrade" does.
  const changed: string[] = [];
  const data: Record<string, unknown> = {};

  for (const f of TEXT_FIELDS) {
    const v = body[f];
    if (v === undefined || v === invoice[f]) continue;
    data[f] = v;
    changed.push(f);
  }
  for (const f of ["invoiceDate", "dueDate"] as const) {
    const v = body[f];
    if (v === undefined || v === (isoDate(invoice[f]) || null)) continue;
    data[f] = isoToDate(v);
    changed.push(f);
  }
  if (body.amount !== undefined && body.amount !== invoice.amount) {
    data.amount = body.amount;
    changed.push("amount");
  }

  // The account per row. Only rows of this invoice, and only where it moved.
  const rows = new Map(invoice.allocations.map((a) => [a.id, a]));
  const accounts = (body.accounts ?? []).filter((a) => {
    const row = rows.get(a.allocationId);
    return row !== undefined && row.account !== a.account;
  });
  if ((body.accounts ?? []).some((a) => !rows.has(a.allocationId))) {
    return fail(422, "supplierInvoice.unknownAllocation");
  }
  if (accounts.length) changed.push("accounts");

  if (changed.length === 0) return new Response(null, { status: 204 });

  // A field typed over is the treasurer's now, not the PDF's.
  if (invoice.prefilled.some((f) => changed.includes(f))) {
    data.prefilled = invoice.prefilled.filter((f) => !changed.includes(f));
  }

  const result = await commit(() =>
    prisma.$transaction(async (tx) => {
      // Still in the state it was judged editable in. Exported in another tab
      // a moment ago, it is not this request's to change.
      applied(
        await tx.supplierInvoice.updateMany({ where: { id: invoice.id, status: invoice.status }, data }),
        "supplierInvoice.changedMeanwhile",
      );
      for (const a of accounts) {
        await tx.supplierInvoiceAllocation.update({
          where: { id: a.allocationId },
          data: { account: a.account },
        });
      }
      await tx.supplierInvoiceEvent.create({
        data: { invoiceId: invoice.id, type: "EDITED", actorId: g.actor.id, diff: { fields: changed } },
      });
    }),
  );
  if (result instanceof Response) return result;
  return new Response(null, { status: 204 });
}

// DELETE /api/supplier-invoices/:id
//
// Something that was never an invoice to pay goes, entirely: the row, its
// documents, its history. Only before anybody has attested it
// (isInvoiceDeletable). The mail it came in stays, as the record that the mail
// was read, which is also what stops the next Gmail sync bringing it back.
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await gate();
  if (!g.ok) return g.res;

  const access = await loadInvoiceFor(g.actor, id);
  if (!access.ok) return access.res;
  const { invoice, can } = access;
  if (!can.canDelete) return refuseChange(invoice, isInvoiceDeletable(invoice.status));

  const documents = await prisma.supplierInvoiceDocument.findMany({
    where: { invoiceId: invoice.id },
    select: { id: true, objectKey: true },
  });

  // Files before the row, as everywhere else: a row kept beside a deleted file
  // is recoverable by trying again, a file left behind with no row is not
  // findable at all.
  for (const d of documents) {
    try {
      await deleteObject(d.objectKey);
    } catch (e) {
      console.error(`[supplier-invoices] ${invoice.id}: could not delete ${d.objectKey}, keeping row`, e);
      return fail(503, "receipt.deleteStorageFailed");
    }
  }

  const result = await commit(async () => {
    applied(
      await prisma.supplierInvoice.deleteMany({ where: { id: invoice.id, status: invoice.status } }),
      "supplierInvoice.changedMeanwhile",
    );
  });
  if (result instanceof Response) return result;
  return new Response(null, { status: 204 });
}
