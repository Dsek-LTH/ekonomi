// Send a konterad levfaktura to Fortnox: make the supplier invoice, unbooked, with the attest page and the invoice PDF attached.
// Made once, never twice (Fortnox has no delete for it): the export lock is taken first and a second press is refused while held.
// One the supplier already has in Fortnox under the same invoice number is not made again: ours is tied to it and takes over its fields and rows.
// Let go when the export is recorded or certainly made nothing; otherwise UNCERTAIN until the treasurer has looked in Fortnox (./release).
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { getObjectBuffer } from "@/lib/server/storage";
import { mergeCoverAndReceipts } from "@/lib/server/pdf-merge";
import { invoiceCoverFacts, renderInvoiceCover } from "@/lib/server/invoice-cover";
import {
  FortnoxError,
  connectFileToSupplierInvoice,
  createSupplierInvoice,
  findSupplierInvoice,
  getSupplierInvoice,
  getServiceToken,
  getSupplier,
  uploadInboxFile,
} from "@/lib/fortnox";
import { userToken } from "@/lib/fortnox/export";
import { canBookkeep } from "@/lib/domain/permissions";
import { exportBlocker, ocrDigits, PAYABLE_ACCOUNT } from "@/lib/domain/supplier-invoice";
import { giroMismatch } from "@/lib/domain/payment-ref";
import { oreToSEK, sekToOre } from "@/lib/domain/money";
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

  // The treasurer's own Fortnox login, before the lock so needing to log in leaves nothing to clean up.
  const auth = await userToken(g.actor.id);
  if (!auth.ok) return auth.res;
  const token = auth.token;

  // Pay where the register says, or know why not. The register is read as the organisation; only the writes are the treasurer's.
  let service: string;
  let supplier;
  try {
    service = await getServiceToken();
    supplier = await getSupplier(service, invoice.fortnoxSupplierNumber!);
  } catch (e) {
    if (e instanceof FortnoxError && e.status === 403)
      return fail(403, "fortnox.missingSupplierScope");
    if (e instanceof FortnoxError && e.status === 409) return fail(409, e.message);
    if (e instanceof FortnoxError && e.status === 404)
      return fail(422, "supplierInvoice.supplierGone");
    throw e;
  }

  // Already in Fortnox (made by hand, or by an earlier export): tie ours to it and take over
  // what Fortnox has, fields and rows, instead of making a second one. The bankgiro check is
  // skipped, since Fortnox pays from its own invoice.
  const link = async (givenNumber: string) => {
    let theirs;
    try {
      theirs = await getSupplierInvoice(service, givenNumber);
    } catch (e) {
      if (e instanceof FortnoxError) return fail(e.status === 403 ? 403 : 502, e.message);
      throw e;
    }
    const lines = theirs.rows.map((r, position) => ({
      invoiceId: invoice.id,
      position,
      account: r.account,
      costCenterCode: r.costCenter,
      project: r.project,
      description: r.text,
      debit: sekToOre(r.debit),
      credit: sekToOre(r.credit),
    }));

    const done = await prisma.$transaction(async (tx) => {
      const { count } = await tx.supplierInvoice.updateMany({
        where: { id: invoice.id, status: "BOOKED", exportClaimedAt: null },
        data: {
          invoiceNumber: theirs.invoiceNumber ?? invoice.invoiceNumber,
          invoiceDate: theirs.invoiceDate ? new Date(theirs.invoiceDate) : invoice.invoiceDate,
          dueDate: theirs.dueDate ? new Date(theirs.dueDate) : invoice.dueDate,
          amount: sekToOre(theirs.total),
          rounding: sekToOre(theirs.roundOff) || null,
          ocr: theirs.ocr,
          yourReference: theirs.yourReference,
          ourReference: theirs.ourReference,
          status: "EXPORTED",
          fortnoxGivenNumber: givenNumber,
          exportedAt: new Date(),
          exportedById: g.actor.id,
        },
      });
      if (count === 0) return false;
      await tx.supplierInvoiceLine.deleteMany({ where: { invoiceId: invoice.id } });
      await tx.supplierInvoiceLine.createMany({ data: lines });
      await tx.supplierInvoiceEvent.create({
        data: {
          invoiceId: invoice.id,
          type: "EXPORTED",
          actorId: g.actor.id,
          comment: givenNumber,
        },
      });
      return true;
    });
    if (!done) return fail(409, "supplierInvoice.exportInProgress");

    // The attest page onto the Fortnox invoice, best effort as for an export.
    let attachFailed: string | null = null;
    try {
      await connectFileToSupplierInvoice(token, await uploadPdf(), givenNumber);
    } catch (e) {
      attachFailed = e instanceof Error ? e.message : String(e);
      console.error(
        `[supplier-invoices] ${invoice.id}: could not attach the PDF to ${givenNumber}`,
        e,
      );
    }
    return NextResponse.json({
      id: invoice.id,
      status: "EXPORTED",
      givenNumber,
      linked: true,
      attachFailed,
    });
  };

  // Does the supplier already have this invoice number in Fortnox?
  let existing: string | null;
  try {
    existing = await findSupplierInvoice(service, supplier.number, invoice.invoiceNumber!);
  } catch (e) {
    if (e instanceof FortnoxError && e.status === 403)
      return fail(403, "fortnox.missingSupplierInvoiceScope");
    if (e instanceof FortnoxError) return fail(502, e.message);
    throw e;
  }
  // The attest page and the invoice's documents as one PDF in Fortnox's inbox, returning its File id.
  const uploadPdf = async () => {
    const cover = await renderInvoiceCover(
      await invoiceCoverFacts(invoice, {
        supplierName: supplier.name,
        exportedBy: g.actor.name,
      }),
    );
    const documents = await prisma.supplierInvoiceDocument.findMany({
      where: { invoiceId: invoice.id },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      select: { objectKey: true, mimeType: true },
    });
    const files = await Promise.all(
      documents.map(async (d) => ({
        bytes: (await getObjectBuffer(d.objectKey)).bytes,
        mimeType: d.mimeType,
      })),
    );
    const merged = await mergeCoverAndReceipts(cover, files);
    const name = `Leverantorsfaktura ${invoice.invoiceNumber} ${supplier.name}`.replace(
      /[^\w .-]/g,
      "_",
    );
    return uploadInboxFile(
      token,
      Buffer.from(merged.bytes),
      `${name}.pdf`,
      "application/pdf",
      "inbox_s",
    );
  };

  if (existing) return link(existing);

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
    data: {
      exportClaimedAt: claimedAt,
      exportClaimedById: g.actor.id,
      exportClaimState: "CLAIMED",
    },
  });
  if (count === 0) return fail(409, "supplierInvoice.exportInProgress");
  const ours = { id: invoice.id, exportClaimedAt: claimedAt };
  const release = () =>
    prisma.supplierInvoice.updateMany({
      where: ours,
      data: { exportClaimedAt: null, exportClaimedById: null, exportClaimState: null },
    });

  let fileId: string;
  try {
    // Into Fortnox's inbox before the invoice is made, so a failure leaves nothing in the books.
    fileId = await uploadPdf();
  } catch (e) {
    await release();
    if (e instanceof FortnoxError)
      return fail(e.status && e.status < 500 ? e.status : 502, e.message);
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
      ocr: invoice.ocr && ocrDigits(invoice.ocr),
      yourReference: invoice.yourReference,
      ourReference: invoice.ourReference,
      // Our number at the end, so the Fortnox invoice traces back.
      comments:
        [invoice.description, invoice.reference && `(${invoice.reference})`]
          .filter(Boolean)
          .join(" ") || null,
      payableAccount: PAYABLE_ACCOUNT,
      ...(invoice.rounding && { rounding: oreToSEK(invoice.rounding) }),
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
    await prisma.supplierInvoice.updateMany({
      where: ours,
      data: { exportClaimState: "UNCERTAIN" },
    });
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
      data: {
        invoiceId: invoice.id,
        type: "EXPORTED",
        actorId: g.actor.id,
        comment: givenNumber,
      },
    });
  });

  // Attaching is best effort: a failure means attaching by hand in Fortnox, not exporting again.
  let attachFailed: string | null = null;
  try {
    await connectFileToSupplierInvoice(token, fileId, givenNumber);
  } catch (e) {
    attachFailed = e instanceof Error ? e.message : String(e);
    console.error(
      `[supplier-invoices] ${invoice.id}: could not attach the PDF to ${givenNumber}`,
      e,
    );
  }

  return NextResponse.json({ id: invoice.id, status: "EXPORTED", givenNumber, attachFailed });
}
