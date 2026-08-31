import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { describe, expect, it } from "vitest";

import {
  fitCentred,
  isMergeableReceipt,
  mergeCoverAndReceipt,
  PdfMergeError,
} from "./pdf-merge";

/** A stand-in for whatever typeset the cover, the merge does not care. */
async function pdfOf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([595.28, 841.89]);
  return doc.save();
}

const pageCount = async (bytes: Uint8Array) =>
  (await PDFDocument.load(bytes)).getPageCount();

/** A real encoded image, since embedJpg/embedPng parse the actual bytes. */
const imageOf = (w: number, h: number, format: "jpeg" | "png") =>
  sharp({ create: { width: w, height: h, channels: 3, background: "#cccccc" } })
    [format]()
    .toBuffer()
    .then((b) => new Uint8Array(b));

describe("mergeCoverAndReceipt", () => {
  it("puts the underlag behind the cover, every page of it", async () => {
    const merged = await mergeCoverAndReceipt(await pdfOf(1), {
      bytes: await pdfOf(4),
      mimeType: "application/pdf",
    });
    expect(await pageCount(merged)).toBe(5);
  });

  it("returns the cover untouched when there is no receipt", async () => {
    // Not an error: an utlägg may legitimately have none, and the cover alone
    // is still the document that substantiates the voucher.
    const cover = await pdfOf(1);
    expect(await mergeCoverAndReceipt(cover, null)).toBe(cover);
  });

  it("gives back the underlag alone when there is no cover", async () => {
    // What keeps a missing typesetter from costing the reader their receipt.
    // The answer is still a PDF, so the viewer is told the same content type
    // whether or not a cover was drawn.
    const merged = await mergeCoverAndReceipt(null, {
      bytes: await pdfOf(3),
      mimeType: "application/pdf",
    });
    expect(await pageCount(merged)).toBe(3);
  });

  it("wraps a bare image underlag onto a page of its own", async () => {
    // The same fallback, for a receipt that is a photo: it cannot be served as
    // application/pdf without being put on a page first.
    const merged = await mergeCoverAndReceipt(null, {
      bytes: await imageOf(800, 1200, "jpeg"),
      mimeType: "image/jpeg",
    });
    expect(await pageCount(merged)).toBe(1);
  });

  it("refuses to invent a document out of nothing", async () => {
    // No cover and no underlag is the one case with nothing to fall back to,
    // and the route has to answer something other than an empty PDF.
    await expect(mergeCoverAndReceipt(null, null)).rejects.toBeInstanceOf(PdfMergeError);
  });

  it("gives a photographed receipt a page of its own", async () => {
    for (const format of ["jpeg", "png"] as const) {
      const merged = await mergeCoverAndReceipt(await pdfOf(1), {
        bytes: await imageOf(800, 1200, format),
        mimeType: `image/${format}`,
      });
      expect(await pageCount(merged)).toBe(2);
    }
  });

  it("gives the image an A4 page to sit on", async () => {
    const merged = await mergeCoverAndReceipt(await pdfOf(1), {
      bytes: await imageOf(2000, 500, "jpeg"),
      mimeType: "image/jpeg",
    });
    const page = (await PDFDocument.load(merged)).getPage(1);
    expect(Math.round(page.getWidth())).toBe(595);
    expect(Math.round(page.getHeight())).toBe(842);
  });

  it("refuses a receipt type that was never storable", async () => {
    // Uploads are normalised to PDF, JPEG or PNG (lib/server/images.ts), so
    // anything else means something upstream changed and should say so loudly.
    await expect(
      mergeCoverAndReceipt(await pdfOf(1), {
        bytes: new Uint8Array([1, 2, 3]),
        mimeType: "image/webp",
      }),
    ).rejects.toBeInstanceOf(PdfMergeError);
  });

  it("wraps unreadable receipt bytes as a merge error, not a raw throw", async () => {
    // This is the case the export's fallback exists for: a supplier's PDF that
    // will not open must not take an otherwise valid export down with it, and
    // the caller can only catch it if it has a type.
    await expect(
      mergeCoverAndReceipt(await pdfOf(1), {
        bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x39, 0x39]),
        mimeType: "application/pdf",
      }),
    ).rejects.toBeInstanceOf(PdfMergeError);
  });
});

describe("fitCentred", () => {
  const A4 = { width: 595.28, height: 841.89 };

  it("never distorts the image", () => {
    // The one wrong answer this function has. A receipt stretched to A4's
    // proportions is evidence somebody has altered.
    for (const img of [
      { width: 2000, height: 500 },
      { width: 500, height: 2000 },
      { width: 1000, height: 1000 },
    ]) {
      const fit = fitCentred(img, A4, 24);
      expect(fit.width / fit.height).toBeCloseTo(img.width / img.height, 5);
    }
  });

  it("keeps the image inside the margin on its limiting axis", () => {
    const wide = fitCentred({ width: 4000, height: 100 }, A4, 24);
    expect(wide.width).toBeCloseTo(A4.width - 48, 5);
    expect(wide.height).toBeLessThan(A4.height - 48);

    const tall = fitCentred({ width: 100, height: 4000 }, A4, 24);
    expect(tall.height).toBeCloseTo(A4.height - 48, 5);
    expect(tall.width).toBeLessThan(A4.width - 48);
  });

  it("centres it on both axes", () => {
    const fit = fitCentred({ width: 800, height: 1200 }, A4, 24);
    expect(fit.x * 2 + fit.width).toBeCloseTo(A4.width, 5);
    expect(fit.y * 2 + fit.height).toBeCloseTo(A4.height, 5);
  });

  it("places a small photo at its own size rather than blowing it up", () => {
    // Upscaling a 200px receipt to fill A4 produces a blur, not a better look
    // at it.
    const fit = fitCentred({ width: 200, height: 150 }, A4, 24);
    expect(fit.width).toBe(200);
    expect(fit.height).toBe(150);
  });
});

describe("isMergeableReceipt", () => {
  it("accepts exactly what a stored receipt can be", () => {
    expect(["application/pdf", "image/jpeg", "image/png"].every(isMergeableReceipt)).toBe(true);
    expect(["image/heic", "image/webp", "text/plain"].some(isMergeableReceipt)).toBe(false);
  });
});
