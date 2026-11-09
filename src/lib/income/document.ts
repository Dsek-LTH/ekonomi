// Rendering the intäktsräkning (typst, lib/income/render.ts) and storing it. Render on demand,
// store at booking, because from then on the document is evidence behind a ledger figure and
// export attaches those same bytes to the Fortnox voucher. The document's address carries the
// report's `updatedAt`, since review edits change the page.

import "server-only";

import { prisma } from "@/lib/server/db";
import { incomeDocumentKey, putObject } from "@/lib/server/storage";

import { buildIncomeDocumentData } from "./document-data";
import { isLegacyReport } from "./legacy";
import { renderIncomePdf } from "./render";
import { isoDay } from "@/lib/domain/date";

/** Why a report has no document. Each is a message key under `errors.income`. */
export type DocumentFailure =
  | { reason: "reportNotFound" }
  /** Booked before the per-day voucher, and stored then. */
  | { reason: "legacyReport" }
  | { reason: "renderFailed"; detail: string }
  | { reason: "storeFailed" };

export type RenderedDocument = { ok: true; bytes: Uint8Array; filename: string };
export type StoredDocument = { ok: true; key: string; filename: string };

export type RenderResult = RenderedDocument | ({ ok: false } & DocumentFailure);
export type StoreResult = StoredDocument | ({ ok: false } & DocumentFailure);

/** Who a rendered report is attested by. */
interface DocumentAttestation {
  name: string;
  studentId: string;
}

/**
 * Render a report to PDF bytes, attested by `attestation`: the reviewer (while a draft, whoever is
 * looking). Once booked the stored document is used and never re-rendered.
 */
export async function renderIncomeDocument(
  reportId: string,
  attestation: DocumentAttestation,
): Promise<RenderResult> {
  const report = await prisma.incomeReport.findUnique({
    where: { id: reportId },
    include: {
      lines: {
        orderBy: { sortOrder: "asc" },
        include: {
          costCenter: { select: { code: true, name: true } },
          resultUnit: { select: { name: true, income: { select: { properName: true } } } },
        },
      },
    },
  });
  if (!report) return { ok: false, reason: "reportNotFound" };
  // An old report's document is read from storage, not redrawn.
  if (isLegacyReport(report) || report.source === "ZETTLE_FEE") {
    return { ok: false, reason: "legacyReport" };
  }

  const date = isoDay(report.date);
  const paymentType = report.source === "SWISH" ? "swish" : "zettle";
  const filename = `${paymentType}-${date}.pdf`;

  const data = buildIncomeDocumentData({
    source: report.source,
    date,
    created: isoDay(new Date()),
    attestation: { name: attestation.name, studentId: attestation.studentId },
    lines: report.lines.map((l) => ({
      kind: l.kind,
      unitName: l.resultUnit ? (l.resultUnit.income?.properName ?? l.resultUnit.name) : null,
      name: l.name,
      variant: l.variant,
      account: l.account,
      accountName: l.accountName,
      costCenter: l.costCenter,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      discount: l.discount,
      total: l.total,
    })),
  });

  try {
    return { ok: true, bytes: await renderIncomePdf(data), filename };
  } catch (e) {
    console.error(`[income] rendering report ${reportId} failed`, e);
    return {
      ok: false,
      reason: "renderFailed",
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}

/** The report's stored document, rendering and storing it if missing. Idempotent: the key derives from the report id. `attestation` is the booker. */
export async function storeIncomeDocument(
  reportId: string,
  attestation: DocumentAttestation,
): Promise<StoreResult> {
  const existing = await prisma.incomeReport.findUnique({
    where: { id: reportId },
    select: { documentKey: true, documentFilename: true },
  });
  if (!existing) return { ok: false, reason: "reportNotFound" };
  if (existing.documentKey && existing.documentFilename) {
    return { ok: true, key: existing.documentKey, filename: existing.documentFilename };
  }

  const rendered = await renderIncomeDocument(reportId, attestation);
  if (!rendered.ok) return rendered;

  const key = incomeDocumentKey(reportId, rendered.filename);
  try {
    await putObject(key, Buffer.from(rendered.bytes), "application/pdf");
  } catch (e) {
    console.error(`[income] storing the document for report ${reportId} failed`, e);
    return { ok: false, reason: "storeFailed" };
  }

  // Only after the bytes are stored: the row says a document exists.
  await prisma.incomeReport.update({
    where: { id: reportId },
    data: { documentKey: key, documentFilename: rendered.filename },
  });

  return { ok: true, key, filename: rendered.filename };
}
