// Export an attested levfaktura to Fortnox: make the supplier invoice, unbooked,
// with the attest page and the invoice PDF attached. Booking it and paying it
// happen in Fortnox, as for every supplier invoice the section has.
//
// Made once, never twice. Fortnox has no delete for a supplier invoice made
// through the API, so the first thing a press of Exportera does is take the
// export lock on the row, and a second press, from anyone, is refused while it
// is held. It is let go when the export is recorded, or when it is certain no
// supplier invoice was made. When that is not certain (Fortnox did not answer,
// or answered with a server error) it stays, UNCERTAIN, until the treasurer
// has looked in Fortnox and said which (./release).
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { getObjectBuffer } from "@/lib/server/storage";
import { mergeCoverAndReceipts } from "@/lib/server/pdf-merge";
import { renderInvoiceCover } from "@/lib/server/invoice-cover";
import {
  FortnoxError,
  connectFileToSupplierInvoice,
  createSupplierInvoice,
  getSupplier,
  uploadInboxFile,
} from "@/lib/fortnox";
import { userToken } from "@/lib/fortnox/export";
import { canBookkeep } from "@/lib/domain/permissions";
import { exportBlocker } from "@/lib/domain/supplier-invoice";
import { giroMismatch } from "@/lib/domain/payment-ref";
import { oreToSEK } from "@/lib/domain/money";
import { fail, gate } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { loadInvoiceFor, refuseChange } from "@/lib/api/supplier-invoice-access";
import { isoDate } from "@/lib/data/shared";

/** The leverantörsskuld account, BAS standard. What every supplier invoice's
 *  total is credited to until it is paid. */
const PAYABLE_ACCOUNT = 2440;

const ExportBody = z.object({
  /** The treasurer has seen the bankgiro warning and pays to the invoice's
   *  number anyway (a supplier who really did change bank). */
  confirmGiro: z.boolean().optional(),
});

/** Whether a failed create certainly made nothing. A 4xx is Fortnox refusing
 *  the request outright; anything else (a timeout, a dropped connection, a
 *  5xx, a 2xx with no number in it) may have made one. */
const certainlyNotCreated = (e: unknown) =>
  e instanceof FortnoxError && e.status !== undefined && e.status >= 400 && e.status < 500;

// POST /api/supplier-invoices/:id/export
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await gate(canBookkeep, "auth.bookkeeperExport");
  if (!g.ok) return g.res;

  const parsed = await parseBody(req, ExportBody);
  if (!parsed.ok) return parsed.res;

  const access = await loadInvoiceFor(g.actor, id);
  if (!access.ok) return access.res;
  const { invoice } = access;
  if (invoice.status !== "APPROVED") return refuseChange(invoice, false);

  // A single row is the whole invoice; a split names its shares.
  const rows = invoice.allocations.map((a) => ({
    ...a,
    share: invoice.allocations.length === 1 ? invoice.amount : a.amount,
  }));
  const blocker = exportBlocker({
    fortnoxSupplierNumber: invoice.fortnoxSupplierNumber,
    invoiceNumber: invoice.invoiceNumber,
    invoiceDate: invoice.invoiceDate,
    dueDate: invoice.dueDate,
    amount: invoice.amount,
    rows: rows.map((r) => ({ amount: r.share, account: r.account })),
  });
  if (blocker) return fail(422, blocker);

  // The treasurer's own Fortnox login, so Fortnox says who made it. Before the
  // lock, so needing to log in leaves nothing to clean up.
  const auth = await userToken(g.actor.id);
  if (!auth.ok) return auth.res;
  const token = auth.token;

  // Pay where the register says, or know why not.
  let supplier;
  try {
    supplier = await getSupplier(token, invoice.fortnoxSupplierNumber!);
  } catch (e) {
    if (e instanceof FortnoxError && e.status === 403) {
      return fail(401, "fortnox.missingScopeLogin", { extra: { needsFortnoxLogin: true } });
    }
    if (e instanceof FortnoxError && e.status === 404) return fail(422, "supplierInvoice.supplierGone");
    throw e;
  }
  const mismatch = giroMismatch(invoice, supplier);
  if (mismatch && !parsed.data.confirmGiro) {
    return fail(409, "supplierInvoice.giroMismatch", {
      values: {
        field: { key: `invoices.field.${mismatch.field}` },
        invoice: mismatch.invoice,
        register: mismatch.register ?? "-",
      },
      extra: { giroMismatch: true },
    });
  }

  // The lock. Still attested and nobody else's is part of the condition.
  const claimedAt = new Date();
  const { count } = await prisma.supplierInvoice.updateMany({
    where: { id: invoice.id, status: "APPROVED", exportClaimedAt: null },
    data: { exportClaimedAt: claimedAt, exportClaimedById: g.actor.id, exportClaimState: "CLAIMED" },
  });
  if (count === 0) return fail(409, "supplierInvoice.exportInProgress");
  const ours = { id: invoice.id, exportClaimedAt: claimedAt };
  const release = () =>
    prisma.supplierInvoice.updateMany({
      where: ours,
      data: { exportClaimedAt: null, exportClaimedById: null, exportClaimState: null },
    });

  let fileId: string | null = null;
  try {
    // The attest page and the invoice, as one PDF, into the supplier invoice
    // folder of Fortnox's inbox, before the invoice is made: a failure here
    // leaves nothing in Fortnox's books.
    const users = await prisma.user.findMany({
      where: { id: { in: invoice.allocations.flatMap((a) => (a.approvedById ? [a.approvedById] : [])) } },
      select: { id: true, name: true },
    });
    const nameOf = new Map(users.map((u) => [u.id, u.name]));
    const cover = await renderInvoiceCover({
      supplierName: supplier.name,
      invoiceNumber: invoice.invoiceNumber!,
      invoiceDate: isoDate(invoice.invoiceDate),
      dueDate: isoDate(invoice.dueDate),
      amount: invoice.amount!,
      description: invoice.description,
      resultUnit: invoice.resultUnit?.name ?? null,
      rows: rows.map((r) => ({
        costCenter: `${r.costCenter.code} - ${r.costCenter.name}`,
        account: r.account!,
        amount: r.share!,
        attestedBy: r.approvedById ? (nameOf.get(r.approvedById) ?? null) : null,
        attestedAt: r.approvedAt,
        comment: r.comment,
      })),
      exportedBy: g.actor.name,
    });
    const documents = await prisma.supplierInvoiceDocument.findMany({
      where: { invoiceId: invoice.id },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      select: { objectKey: true, mimeType: true },
    });
    const files = await Promise.all(
      documents.map(async (d) => ({ bytes: (await getObjectBuffer(d.objectKey)).bytes, mimeType: d.mimeType })),
    );
    const merged = await mergeCoverAndReceipts(cover, files);
    const name = `Leverantorsfaktura ${invoice.invoiceNumber} ${supplier.name}`.replace(/[^\w .-]/g, "_");
    fileId = await uploadInboxFile(token, Buffer.from(merged.bytes), `${name}.pdf`, "application/pdf", "inbox_s");
  } catch (e) {
    await release();
    if (e instanceof FortnoxError) return fail(e.status && e.status < 500 ? e.status : 502, e.message);
    throw e;
  }

  // From here the supplier invoice may exist.
  await prisma.supplierInvoice.updateMany({ where: ours, data: { exportClaimState: "SENT" } });
  let givenNumber: string;
  try {
    givenNumber = await createSupplierInvoice(token, {
      supplierNumber: supplier.number,
      invoiceNumber: invoice.invoiceNumber!,
      invoiceDate: isoDate(invoice.invoiceDate),
      dueDate: isoDate(invoice.dueDate),
      total: oreToSEK(invoice.amount),
      ocr: invoice.ocr,
      yourReference: invoice.yourReference,
      comments: invoice.description,
      payableAccount: PAYABLE_ACCOUNT,
      rows: rows.map((r) => ({
        account: Number(r.account),
        amount: oreToSEK(r.share),
        costCenter: r.costCenter.code,
        project: r.project ?? undefined,
        text: r.comment ?? undefined,
      })),
    });
  } catch (e) {
    if (certainlyNotCreated(e)) {
      await release();
      return fail((e as FortnoxError).status!, (e as Error).message);
    }
    await prisma.supplierInvoice.updateMany({ where: ours, data: { exportClaimState: "UNCERTAIN" } });
    console.error(`[supplier-invoices] ${invoice.id}: export outcome unknown`, e);
    return fail(502, "supplierInvoice.exportUncertain");
  }

  await prisma.$transaction(async (tx) => {
    await tx.supplierInvoice.updateMany({
      where: ours,
      data: {
        status: "EXPORTED",
        fortnoxGivenNumber: givenNumber,
        exportedAt: new Date(),
        exportedById: g.actor.id,
        exportClaimedAt: null,
        exportClaimedById: null,
        exportClaimState: null,
      },
    });
    await tx.supplierInvoiceEvent.create({
      data: { invoiceId: invoice.id, type: "EXPORTED", actorId: g.actor.id, comment: givenNumber },
    });
  });

  // Attaching the file is the one step after the invoice exists, so it is
  // best effort: a failure means attaching it by hand in Fortnox, not
  // exporting again.
  let attachFailed: string | null = null;
  try {
    await connectFileToSupplierInvoice(token, fileId, givenNumber);
  } catch (e) {
    attachFailed = e instanceof Error ? e.message : String(e);
    console.error(`[supplier-invoices] ${invoice.id}: could not attach the PDF to ${givenNumber}`, e);
  }

  return NextResponse.json({ id: invoice.id, status: "EXPORTED", givenNumber, attachFailed });
}
