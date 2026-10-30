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
// Rendering on demand is safe because what the document shows (the day, the
// verksamhet, the product lines) is settled when the report is stored, so the
// same report renders to the same document every time. It is built here in
// full and sent whole: the service knows nothing about the section. The one field review
// can change, the cost centre, appears nowhere on the page; it decides where the
// money is booked, not what the document says.
import "server-only";

import { prisma } from "@/lib/server/db";
import { incomeDocumentKey, putObject } from "@/lib/server/storage";

import { IntaktError, IntaktNotConfiguredError, renderDocument } from "./client";
import { distributionsFor } from "./report";
import type { IncomeDocument } from "./types";

/**
 * Why a report has no document. Each maps to a message key under
 * `errors.income`, so a route can hand it straight to `fail()`.
 */
export type DocumentFailure =
  | { reason: "reportNotFound" }
  | { reason: "serviceUnavailable" }
  | { reason: "renderFailed"; detail: string }
  | { reason: "storeFailed" };

export type RenderedDocument = { ok: true; bytes: Uint8Array; filename: string };
export type StoredDocument = { ok: true; key: string; filename: string };

export type RenderResult = RenderedDocument | ({ ok: false } & DocumentFailure);
export type StoreResult = StoredDocument | ({ ok: false } & DocumentFailure);

/** What a day of Zettle's fees is called on its page. */
const FEE_TITLE = "Zettleavgifter";

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
      resultUnit: {
        select: { name: true, income: { select: { key: true, properName: true, description: true } } },
      },
      costCenter: { select: { name: true } },
      lines: { orderBy: { sortOrder: "asc" } },
    },
  });
  if (!report) return { ok: false, reason: "reportNotFound" };

  const isFee = report.source === "ZETTLE_FEE";
  const dateStr = report.date.toISOString().slice(0, 10);
  const filename = isFee
    ? `avgift-${dateStr}.pdf`
    : `${report.resultUnit?.income?.key ?? "intakt"}-${dateStr}.pdf`;

  // The verksamhet as its documents name it: the override where it has one,
  // otherwise the unit's own name. Fees belong to no verksamhet, so their page
  // names the cost centre they are booked on.
  const income = report.resultUnit?.income;
  const unit = isFee
    ? (report.costCenter?.name ?? FEE_TITLE)
    : (income?.properName ?? report.resultUnit?.name ?? "");
  const document: IncomeDocument = {
    kind: isFee ? "fee" : "income",
    paymentType: report.source === "SWISH" ? "Swish" : "Zettle",
    unit,
    description: isFee ? FEE_TITLE : (income?.description || unit),
    date: dateStr,
    attestation: { name: attestation.name, stilId: attestation.studentId },
    lines: report.lines.map((l) => ({
      name: l.name,
      // Omitted rather than sent as null: the service's field is
      // `variant,omitempty`.
      ...(l.variant ? { variant: l.variant } : {}),
      account: l.account,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      effectiveDiscount: l.discount,
      total: l.total,
    })),
    distributions: distributionsFor(report.lines),
    total: report.total,
  };

  try {
    const bytes = await renderDocument(document);
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
