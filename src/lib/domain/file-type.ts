// What an uploaded file actually is, judged by its first bytes. The multipart Content-Type is client-supplied and worth nothing,
// so the recorded type is the one read from the file, and unrecognisable bytes are not a receipt.

/** The formats a receipt may be. A union, not an array: every member is spelled out again in the sniffing below. */
type ReceiptType =
  "image/jpeg" | "image/png" | "image/webp" | "image/heic" | "image/heif" | "application/pdf";

/** Bytes needed to recognise any of the formats above (HEIC's brand ends at 12). */
export const SNIFF_BYTES = 12;

const ascii = (bytes: Uint8Array, start: number, end: number): string =>
  String.fromCharCode(...bytes.subarray(start, end));

const startsWith = (bytes: Uint8Array, sig: readonly number[]): boolean =>
  sig.every((b, i) => bytes[i] === b);

// ISO base-media brands for a HEVC still image: phones usually write `heic`; `mif1`/`msf1` are the generic HEIF ones.
const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs"]);
const HEIF_BRANDS = new Set(["mif1", "msf1"]);

/** The type these bytes are, or null. Only the first `SNIFF_BYTES` are read, so a caller may check the head before buffering the rest. */
export function sniffReceiptType(bytes: Uint8Array): ReceiptType | null {
  // JPEG: SOI marker, then the start of the first segment.
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";

  // PNG: the 8-byte signature, chosen by the format to survive mangling.
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";

  // WebP: a RIFF container whose form type is WEBP (the four bytes between are the length).
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return "image/webp";

  // HEIC/HEIF: an ISO base-media file, whose brand follows the `ftyp` box type.
  if (ascii(bytes, 4, 8) === "ftyp") {
    const brand = ascii(bytes, 8, 12);
    if (HEIC_BRANDS.has(brand)) return "image/heic";
    if (HEIF_BRANDS.has(brand)) return "image/heif";
  }

  // PDF: the header at the very start. Junk before it is not tolerated: that would be something else first.
  if (ascii(bytes, 0, 5) === "%PDF-") return "application/pdf";

  return null;
}
