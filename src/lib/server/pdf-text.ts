// A PDF's text layer, as lines in reading order, for the invoice prefill
// (lib/domain/invoice-text.ts).
//
// pdfjs, the same library the receipt viewer draws PDFs with, run on the
// server. Its worker is loaded into this process and handed to it through
// `globalThis.pdfjsWorker`, which pdfjs looks for before it tries to start a
// worker of its own: a server has no Worker to start, and the import below is
// also what makes the standalone build trace the worker file in.
//
// Best effort throughout. An invoice whose text cannot be read is one whose
// fields are typed by hand, which is how every invoice was before this.
import "server-only";

// How much of a PDF is read. An invoice's fields are on its first page or two;
// the rest is specification.
const MAX_PAGES = 3;

type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
let loaded: Promise<PdfJs> | null = null;

function pdfjs(): Promise<PdfJs> {
  loaded ??= (async () => {
    // @ts-expect-error The worker ships without types. Nothing is read off it
    // here, pdfjs takes it whole.
    const worker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
    (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = worker;
    return import("pdfjs-dist/legacy/build/pdf.mjs");
  })();
  return loaded;
}

interface TextItem {
  str: string;
  transform: number[];
}

/**
 * The text of the first pages, one string per printed line, top to bottom.
 * Items are grouped into a line by their baseline, within a point or two, and
 * joined left to right with the gaps kept as spaces, so "Att betala" and the
 * amount far to its right end up on one line the way a reader sees them.
 */
export async function pdfLines(bytes: Uint8Array): Promise<string[]> {
  try {
    const { getDocument } = await pdfjs();
    const doc = await getDocument({
      data: new Uint8Array(bytes),
      // No fonts fetched, nothing evaluated: the text layer is all this wants.
      disableFontFace: true,
      isEvalSupported: false,
      useSystemFonts: false,
    }).promise;
    const out: string[] = [];
    for (let p = 1; p <= Math.min(doc.numPages, MAX_PAGES); p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const items = (content.items as TextItem[]).filter((i) => typeof i.str === "string" && i.str.trim());
      const rows: { y: number; parts: { x: number; s: string }[] }[] = [];
      for (const it of items) {
        const [x, y] = [it.transform[4], it.transform[5]];
        const row = rows.find((r) => Math.abs(r.y - y) < 2);
        if (row) row.parts.push({ x, s: it.str });
        else rows.push({ y, parts: [{ x, s: it.str }] });
      }
      rows.sort((a, b) => b.y - a.y);
      for (const r of rows) {
        out.push(
          r.parts
            .sort((a, b) => a.x - b.x)
            .map((part) => part.s)
            .join(" ")
            .replace(/\s+/g, " ")
            .trim(),
        );
      }
    }
    await doc.destroy();
    return out;
  } catch (err) {
    console.warn("[pdf-text] could not read text layer", err);
    return [];
  }
}
