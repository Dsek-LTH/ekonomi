// Stapling the underlag onto a cover page. Cover and receipts are stored apart and joined on the way out
// to Fortnox, so receipt bytes are held once. Done with pdf-lib, not Typst: receipts are arbitrary input
// (encrypted files, newer PDF versions) and Typst cannot report page counts (typst#6644).
import "server-only";

import { PDFDocument } from "pdf-lib";

/** A4 in PostScript points, which is what pdf-lib measures pages in. */
const A4 = { width: 595.28, height: 841.89 };

/** Whitespace around a receipt photographed onto its own page. */
const IMAGE_MARGIN = 24;

/**
 * Thrown when the underlag cannot be joined on. Callers do not treat it as a failure: the export still
 * goes ahead with the receipt attached separately (api/expenses/[id]/export/route.ts).
 */
export class PdfMergeError extends Error {}

/** What this can staple on: exactly what a stored receipt can be (images normalised at upload, lib/server/images.ts). */
export function isMergeableReceipt(mimeType: string): boolean {
  return mimeType === "application/pdf" || mimeType === "image/jpeg" || mimeType === "image/png";
}

/** The largest the image can be drawn inside `box` without distorting it, centred. Capped at 1 so a small photo is not blown up. */
export function fitCentred(
  image: { width: number; height: number },
  page: { width: number; height: number },
  margin: number,
): { x: number; y: number; width: number; height: number } {
  const scale = Math.min(
    (page.width - margin * 2) / image.width,
    (page.height - margin * 2) / image.height,
    1,
  );
  const width = image.width * scale;
  const height = image.height * scale;
  return { x: (page.width - width) / 2, y: (page.height - height) / 2, width, height };
}

/**
 * Cover first, then every underlag in upload order. Either half may be absent; both absent is nothing.
 * Unlabelled on purpose: Fortnox gets what a human would read on paper. One receipt refusing to merge does
 * not cost the others, and `failed` counts the ones left out.
 */
export async function mergeCoverAndReceipts(
  cover: Uint8Array | null,
  receipts: { bytes: Uint8Array; mimeType: string }[],
): Promise<{ bytes: Uint8Array; failed: number }> {
  if (!cover && receipts.length === 0) {
    throw new PdfMergeError("there is neither a cover page nor an underlag to show");
  }

  let out: PDFDocument;
  try {
    out = cover ? await PDFDocument.load(cover) : await PDFDocument.create();
  } catch (e) {
    // A bug rather than bad input, but still must not throw something untyped.
    throw new PdfMergeError(`the cover page could not be reopened: ${message(e)}`);
  }

  let failed = 0;
  for (const receipt of receipts) {
    try {
      await appendReceiptPages(out, receipt);
    } catch (e) {
      failed++;
      console.error(`[pdf-merge] an underlag could not be appended: ${message(e)}`);
    }
  }

  if (!cover && failed === receipts.length) {
    throw new PdfMergeError("no underlag could be appended and there is no cover");
  }

  return { bytes: await out.save(), failed };
}

/** One receipt's bytes, drawn onto its own page(s) at the end of `out`. */
async function appendReceiptPages(
  out: PDFDocument,
  receipt: { bytes: Uint8Array; mimeType: string },
): Promise<void> {
  if (!isMergeableReceipt(receipt.mimeType)) {
    throw new PdfMergeError(`cannot append a receipt of type ${receipt.mimeType}`);
  }
  try {
    if (receipt.mimeType === "application/pdf") {
      // `ignoreEncryption` passes PDFs marked read-only with an empty owner password. A password-protected one still throws.
      const src = await PDFDocument.load(receipt.bytes, { ignoreEncryption: true });
      const pages = await out.copyPages(src, src.getPageIndices());
      for (const page of pages) out.addPage(page);
    } else {
      const image =
        receipt.mimeType === "image/jpeg"
          ? await out.embedJpg(receipt.bytes)
          : await out.embedPng(receipt.bytes);

      const page = out.addPage([A4.width, A4.height]);
      page.drawImage(image, fitCentred(image, A4, IMAGE_MARGIN));
    }
  } catch (e) {
    if (e instanceof PdfMergeError) throw e;
    throw new PdfMergeError(`the underlag could not be appended: ${message(e)}`);
  }
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
