// Stapling an underlag onto a cover page.
//
// The cover and the receipt are stored apart and joined here, on the way out to
// Fortnox, the one place that needs the two of them as a single file. Two
// things fall out of that, and both are the reason it is done this way:
//
// The receipt's bytes are held once. A merged document archived beside the
// receipt it contains is the same file twice; on the sample utlägg that is
// 175KB of the 212KB.
//
// And the result stays reproducible without being archived. Both inputs are
// immutable. A receipt upload replaces its predecessor's object and row in one
// transaction (api/expenses/[id]/receipts/route.ts), and a cover is written
// once when the utlägg is booked, so exporting the same utlägg twice uploads
// the same document without one ever having been stored.
//
// Nobody reads the result on screen. Stapling a photographed receipt behind a
// cover means laying it on an A4 sheet to make it a page, and that sheet is
// white, right for a file being filed, wrong for a panel. The viewer is given
// the two documents as they are (lib/expense/document-url.ts).
//
// Deliberately not Typst's job, though it can include PDF pages. Receipts are
// whatever a supplier's till printed: an embedded PDF's version may not exceed
// the export target's, encrypted files are refused, and the language cannot
// report a document's page count (typst#6644). pdf-lib is built for input
// nobody chose, so the input nobody chose goes through pdf-lib.
import "server-only";

import { PDFDocument } from "pdf-lib";

/** A4 in PostScript points, which is what pdf-lib measures pages in. */
const A4 = { width: 595.28, height: 841.89 };

/** Whitespace around a receipt photographed onto its own page. */
const IMAGE_MARGIN = 24;

/**
 * Thrown when the underlag cannot be joined on. Its own type because the
 * callers do not treat it as a failure: an export whose receipt will not merge
 * still exports, with the receipt attached as it always was. See
 * api/expenses/[id]/export/route.ts. Losing the cover page is a worse outcome
 * than it being a separate file, and both are far better than an utlägg that
 * cannot be booked because a supplier encrypted their PDF.
 */
export class PdfMergeError extends Error {}

/** What this can staple on. Exactly what a stored receipt can be. Images are
 *  normalised to JPEG or PNG at upload (lib/server/images.ts). */
export function isMergeableReceipt(mimeType: string): boolean {
  return (
    mimeType === "application/pdf" || mimeType === "image/jpeg" || mimeType === "image/png"
  );
}

/**
 * The largest the image can be drawn inside `box` without distorting it, and
 * where to put it so it sits centred on the page.
 *
 * Its own function because it is the only arithmetic here and the only part
 * with a wrong answer: a receipt stretched to A4's proportions is evidence
 * somebody has altered. Capped at 1 so a small photo is placed at its own size
 * rather than blown up into a blur.
 */
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
 * Cover first, then the underlag.
 *
 * Either half may be absent, and neither is an error.
 *
 * A null receipt is an utlägg with no underlag, which is a bookkeeping
 * judgement made when it was booked. The cover alone is still the document
 * that substantiates the voucher.
 *
 * A null cover is the typesetter having failed: the underlag comes back as a
 * PDF on its own, so the answer is `application/pdf` either way. No caller
 * asks for it today. The export refuses to file a voucher without its attest
 * trail (see its note), and the viewer is handed the two documents unmerged,
 * but a merge that drops half its input on the floor is the wrong shape for
 * one that is reached for whenever these two have to become one file.
 *
 * Both null is nothing, and that the caller does have to handle.
 */
export async function mergeCoverAndReceipt(
  cover: Uint8Array | null,
  receipt: { bytes: Uint8Array; mimeType: string } | null,
): Promise<Uint8Array> {
  if (!cover && !receipt) {
    throw new PdfMergeError("there is neither a cover page nor an underlag to show");
  }
  if (!receipt) return cover!;
  if (!isMergeableReceipt(receipt.mimeType)) {
    throw new PdfMergeError(`cannot append a receipt of type ${receipt.mimeType}`);
  }

  let out: PDFDocument;
  try {
    // No cover means starting from an empty document rather than from one, so
    // the append below is the same code in both cases.
    out = cover ? await PDFDocument.load(cover) : await PDFDocument.create();
  } catch (e) {
    // The cover is ours and was made moments ago, so this is a bug rather than
    // bad input, but it still must not throw something untyped at a caller
    // that is catching for the receipt's sake.
    throw new PdfMergeError(`the cover page could not be reopened: ${message(e)}`);
  }

  try {
    if (receipt.mimeType === "application/pdf") {
      // `ignoreEncryption` gets us through the common case: a PDF marked
      // read-only with an empty owner password, which is most of what a
      // supplier's invoice generator emits. A genuinely password-protected one
      // still throws, and the caller falls back.
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

  return out.save();
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
