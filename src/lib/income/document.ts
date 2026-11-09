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
// Rendering on demand is safe because the document is a function of the
// report's lines: the same lines render to the same page. Review can change a
// line's verksamhet, account or cost centre, and the page follows, since its
// sections and its distribution table are built from exactly those. The
// document's address carries the report's `updatedAt` for that reason (see
// documentUrl in the review screen). Rendered in-process with typst
// (lib/income/render.ts).
import "server-only";

import { prisma } from "@/lib/server/db";
import { incomeDocumentKey, putObject } from "@/lib/server/storage";

import { buildIncomeDocumentData } from "./document-data";
import { isLegacyReport } from "./legacy";
import { renderIncomePdf } from "./render";
import { isoDay } from "@/lib/domain/date";

/**
 * Why a report has no document. Each maps to a message key under
 * `errors.income`, so a route can hand it straight to `fail()`.
 */
export type DocumentFailure =
  | { reason: "reportNotFound" }
  /** Booked before the per-day voucher, and stored then. See lib/income/legacy.ts. */
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
 * Render a report to PDF bytes.
 *
 * Attested by `attestation`: the person reviewing the day. A report is a
 * statement someone stands behind, and every day is reviewed against this very
 * document before it is booked, so the one who approves it is that someone.
 * While it is a draft that is whoever is looking at it, which is who would be
 * approving it. Once booked the document is stored (below) with the reviewer's
 * name on it and never rendered again, so a booked day says the same thing
 * whoever opens it.
 *
 * It used to name the person who ran the fetch, which said nothing about who
 * had actually looked at the day.
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
  // An old report's document was stored when it was booked and is read from
  // storage. This page cannot draw one, and has no business redrawing it.
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
    return { ok: false, reason: "renderFailed", detail: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * The report's stored document, rendering and storing it if it has none.
 *
 * Idempotent: a report that already has one is not rendered again, which is
 * what makes it safe for booking to call unconditionally. The key is derived
 * from the report id, so even a double call writes the same object twice rather
 * than leaving two. `attestation` is the reviewer, the one booking it.
 */
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

  // Only after the bytes are in storage: the row is what says a document
  // exists, so writing it first would leave a row pointing at nothing.
  await prisma.incomeReport.update({
    where: { id: reportId },
    data: { documentKey: key, documentFilename: rendered.filename },
  });

  return { ok: true, key, filename: rendered.filename };
}
