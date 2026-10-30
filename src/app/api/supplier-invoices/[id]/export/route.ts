// Send a konterad levfaktura to Fortnox: make the supplier invoice, unbooked,
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
import { exportBlocker, PAYABLE_ACCOUNT, ROUNDING_ACCOUNT } from "@/lib/domain/supplier-invoice";
import { giroMismatch } from "@/lib/domain/payment-ref";
import { oreToSEK } from "@/lib/domain/money";
import { fail, gate } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { exportFactsOf, loadInvoiceFor, refuseChange } from "@/lib/api/supplier-invoice-access";
import { isoDate } from "@/lib/data/shared";

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
  if (invoice.status !== "BOOKED") return refuseChange(invoice, false);

  const blocker = exportBlocker(exportFactsOf(invoice));
  if (blocker) return fail(422, blocker);
  // What each unit signed for, for the attest page: a single row is the whole
  // invoice, a split names its shares.
  const shares = invoice.allocations.map((a) => ({
    ...a,
    share: invoice.allocations.length === 1 ? invoice.amount! : a.amount!,
  }));

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

  // The lock. Still konterad and nobody else's is part of the condition.
  const claimedAt = new Date();
  const { count } = await prisma.supplierInvoice.updateMany({
    where: { id: invoice.id, status: "BOOKED", exportClaimedAt: null },
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
      rows: shares.map((r) => ({
        costCenter: `${r.costCenter.code} - ${r.costCenter.name}`,
        // The accounts the kontering booked this cost centre's share on.
        account:
          [...new Set(invoice.lines.filter((l) => l.costCenterCode === r.costCenter.code).map((l) => l.account))].join(
            ", ",
          ) || "-",
        amount: r.share,
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
      ourReference: invoice.ourReference,
      // Our number at the end, as an utlägg's is on its voucher, so the
      // invoice in Fortnox can be traced back to the one here.
      comments: [invoice.description, invoice.reference && `(${invoice.reference})`].filter(Boolean).join(" ") || null,
      payableAccount: PAYABLE_ACCOUNT,
      ...(invoice.rounding && { rounding: { account: ROUNDING_ACCOUNT, amount: oreToSEK(invoice.rounding) } }),
      // The kontering as the treasurer saved it. With the rounding, its
      // lines book exactly the amount to pay (exportBlocker).
      rows: invoice.lines.map((l) => ({
        account: Number(l.account),
        debit: oreToSEK(l.debit),
        credit: oreToSEK(l.credit),
        costCenter: l.costCenterCode ?? undefined,
        project: l.project ?? undefined,
        text: l.description ?? undefined,
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
