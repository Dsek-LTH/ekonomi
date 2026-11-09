// Converts an iPhone HEIC to JPEG at pick time so the wizard can preview it outside Safari.
// The server converts too (lib/server/images.ts) and still has to; this is only for the preview.
import { SNIFF_BYTES, sniffReceiptType } from "@/lib/domain/file-type";

/**
 * `file` as a JPEG if it is a HEIC, else `file`. Never throws: an unconvertible HEIC is returned for the server to try.
 * Detected from the first bytes, since some browsers leave `file.type` empty.
 */
export async function displayableFile(file: File): Promise<File> {
  try {
    const head = new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer());
    const type = sniffReceiptType(head);
    if (type !== "image/heic" && type !== "image/heif") return file;

    // libheif as WebAssembly is ~700 kB gzipped, loaded only on a HEIC pick.
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
