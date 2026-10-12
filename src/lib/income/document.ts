// Rendering the intäktsräkning, and the one point at which it is kept.
//
// Two operations, deliberately apart:
//
//   renderIncomeDocument: bytes, and nothing else. What the review screen
//                          reads. A day nobody books is a PDF nobody keeps.
//   storeIncomeDocument:  the same bytes, written to object storage and
//                          recorded on the report. Called when a day is
//                          booked, because from that moment the document is
//                          the evidence behind a figure in the ledger and has
//                          to be the same bytes forever. They are the ones export
//                          attaches to the voucher in Fortnox.
//
// It has been both ways round. Rendering at booking meant the document could
// not be read until the takings had been booked on the strength of it, which is
// backwards. Rendering *and storing* at import meant a term of Swish left a
// hundred-odd PDFs in storage for days that were skipped or never booked. This
// is the split those two attempts were circling: render whenever anyone looks,
// store when it starts to matter.
//
// Rendering on demand is safe because what the service renders from (the day,
// the verksamhet, the product lines) is settled when the report is stored, so
// the same report renders to the same document every time. The one field review
// can change, the cost centre, appears nowhere on the page; it decides where the
// money is booked, not what the document says.
import "server-only";

import { prisma } from "@/lib/server/db";
import { incomeDocumentKey, putObject } from "@/lib/server/storage";

import {
  IntaktError,
  IntaktNotConfiguredError,
  renderFeeReport,
  renderReport,
} from "./client";
import { buildIntaktConfig, type IncomeConfigBlocker } from "./config";
import { toFeeReportDto, toReportDto } from "./report";

/**
 * Why a report has no document. Each maps to a message key under
 * `errors.income`, so a route can hand it straight to `fail()`.
 */
export type DocumentFailure =
  | { reason: "reportNotFound" }
  | { reason: "serviceUnavailable" }
  | { reason: "noAttestation" }
  | { reason: "config"; blocker: IncomeConfigBlocker; detail?: string }
  | { reason: "renderFailed"; detail: string }
  | { reason: "storeFailed" };

export type RenderedDocument = { ok: true; bytes: Uint8Array; filename: string };
export type StoredDocument = { ok: true; key: string; filename: string };

export type RenderResult = RenderedDocument | ({ ok: false } & DocumentFailure);
export type StoreResult = StoredDocument | ({ ok: false } & DocumentFailure);

/** Who the rendered report is attested by, when the batch cannot say. */
interface DocumentAttestation {
  name: string;
  studentId: string;
}

/**
 * Render a report to PDF bytes.
 *
 * The attestation is the person who imported the batch, not whoever happens to
 * be asking. A report is a statement someone stands behind, and the one who
 * fetched the day's takings is that someone. Otherwise the same document would
 * carry a different name depending on who opened it. `fallback` covers a batch
 * whose importer has since been removed from the app.
 */
export async function renderIncomeDocument(
  reportId: string,
  fallback?: DocumentAttestation,
): Promise<RenderResult> {
  const report = await prisma.incomeReport.findUnique({
    where: { id: reportId },
    include: {
      resultUnit: { select: { name: true, income: { select: { key: true } } } },
      lines: { orderBy: { sortOrder: "asc" } },
      batch: { select: { createdBy: { select: { name: true, studentId: true } } } },
    },
  });
  if (!report) return { ok: false, reason: "reportNotFound" };

  const attestation = report.batch.createdBy ?? fallback;
  // Rendering with nobody to attest it would produce a document signed by no
  // one, which is worse than not having one.
  if (!attestation) return { ok: false, reason: "noAttestation" };

  const cfg = await buildIntaktConfig({
    name: attestation.name,
    studentId: attestation.studentId,
  });
  if (!cfg.ok) return { ok: false, reason: "config", blocker: cfg.blocker, detail: cfg.detail };

  const isFee = report.source === "ZETTLE_FEE";
  const dateStr = report.date.toISOString().slice(0, 10);
  const filename = isFee
    ? `avgift-${dateStr}.pdf`
    : `${report.resultUnit?.income?.key ?? "intakt"}-${dateStr}.pdf`;

  try {
    const bytes = isFee
      ? await renderFeeReport(toFeeReportDto(report), cfg.config)
      : await renderReport(
          toReportDto(report),
          cfg.config,
          report.source === "SWISH" ? "Swish" : "Zettle",
        );
    return { ok: true, bytes, filename };
  } catch (e) {
    if (e instanceof IntaktNotConfiguredError) return { ok: false, reason: "serviceUnavailable" };
    if (e instanceof IntaktError) {
      console.error(`[intakt] rendering report ${reportId} failed`, e);
      return { ok: false, reason: "renderFailed", detail: e.message };
    }
    throw e;
  }
}

/**
 * The report's stored document, rendering and storing it if it has none.
 *
 * Idempotent: a report that already has one is not rendered again, which is
 * what makes it safe for booking to call unconditionally. The key is derived
 * from the report id, so even a double call writes the same object twice rather
 * than leaving two.
 */
export async function storeIncomeDocument(
  reportId: string,
  fallback?: DocumentAttestation,
): Promise<StoreResult> {
  const existing = await prisma.incomeReport.findUnique({
    where: { id: reportId },
    select: { documentKey: true, documentFilename: true },
  });
  if (!existing) return { ok: false, reason: "reportNotFound" };
  if (existing.documentKey && existing.documentFilename) {
    return { ok: true, key: existing.documentKey, filename: existing.documentFilename };
  }

  const rendered = await renderIncomeDocument(reportId, fallback);
  if (!rendered.ok) return rendered;

  const key = incomeDocumentKey(reportId, rendered.filename);
  try {
    await putObject(key, Buffer.from(rendered.bytes), "application/pdf");
  } catch (e) {
    console.error(`[income] storing the document for report ${reportId} failed`, e);
    return { ok: false, reason: "storeFailed" };
  }

  // Only after the bytes are in storage: the row is what says a document
  // exists, so writing it first would leave a row pointing at nothing.
  await prisma.incomeReport.update({
    where: { id: reportId },
    data: { documentKey: key, documentFilename: rendered.filename },
  });

  return { ok: true, key, filename: rendered.filename };
}
