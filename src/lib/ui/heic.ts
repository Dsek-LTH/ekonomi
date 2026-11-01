// An iPhone photo made into something every browser can draw, at the moment it
// is picked. The new-utlägg wizard holds documents in the browser until the
// save (see expenses/new), and outside Safari a HEIC there cannot be shown at
// all, so the reader picked a receipt and got a grey "HEIC" tile back.
//
// The server converts HEIC too (lib/server/images.ts), and still has to: not
// every upload comes through here. This one is about the preview.
import { SNIFF_BYTES, sniffReceiptType } from "@/lib/domain/file-type";

/**
 * `file` as a JPEG if it is a HEIC, otherwise `file` itself. Never throws: a
 * HEIC this cannot convert is returned as it came, for the server to try.
 *
 * Decided by the file's own first bytes, not `file.type`, which some browsers
 * leave empty for a HEIC.
 */
export async function displayableFile(file: File): Promise<File> {
  try {
    const head = new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer());
    const type = sniffReceiptType(head);
    if (type !== "image/heic" && type !== "image/heif") return file;

    // libheif as WebAssembly is about 700 kB gzipped, loaded only by somebody
    // who has picked a HEIC.
    const { default: decode } = await import("heic-decode");
    const { width, height, data } = await decode({
      buffer: new Uint8Array(await file.arrayBuffer()),
    });

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.putImageData(new ImageData(data, width, height), 0, 0);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.9),
    );
    if (!blob) return file;

    const name = `${file.name.replace(/\.[^.]+$/, "") || "kvitto"}.jpg`;
    return new File([blob], name, { type: "image/jpeg", lastModified: file.lastModified });
  } catch {
    return file;
  }
}
