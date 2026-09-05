// What an uploaded file actually is, judged by its first bytes.
//
// A multipart upload carries a Content-Type, and it is worth exactly nothing:
// it is a field the client fills in, not a fact about the bytes. Accepting a
// receipt on that basis means anything at all can be stored under a type we
// later hand back to a browser, so the type the app records is the one read
// out of the file itself, and a file whose bytes say nothing recognisable is
// not a receipt.
//
// Pure and byte-level on purpose: it belongs beside the other rules rather than
// in lib/server, and it is the sort of thing worth having tests for.

/**
 * The formats a receipt may be. Everything else is refused.
 *
 * A union rather than a runtime array: nothing iterates the list, and every
 * member is spelled out again in the sniffing below, which is where a format is
 * actually recognised. An array would be a second list to keep in step.
 */
type ReceiptType =
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "image/heic"
  | "image/heif"
  | "application/pdf";

/** Bytes needed to recognise any of the formats above (HEIC's brand ends at 12). */
export const SNIFF_BYTES = 12;

const ascii = (bytes: Uint8Array, start: number, end: number): string =>
  String.fromCharCode(...bytes.subarray(start, end));

const startsWith = (bytes: Uint8Array, sig: readonly number[]): boolean =>
  sig.every((b, i) => bytes[i] === b);

// ISO base-media brands that mean "a still image in a HEVC container". A phone
// photo is usually `heic`; `mif1`/`msf1` are the generic image brands, which is
// what the HEIF ones report.
const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs"]);
const HEIF_BRANDS = new Set(["mif1", "msf1"]);

/**
 * The type these bytes are, or null when they are none of them.
 *
 * Only the first `SNIFF_BYTES` are read, so a caller may check a file's head
 * before deciding to buffer the rest of it.
 */
export function sniffReceiptType(bytes: Uint8Array): ReceiptType | null {
  // JPEG: SOI marker, then the start of the first segment.
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";

  // PNG: the 8-byte signature, chosen by the format to survive mangling.
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";

  // WebP: a RIFF container whose form type is WEBP. The four bytes between are
  // the length, which says nothing about the format.
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return "image/webp";

  // HEIC/HEIF: an ISO base-media file, whose brand follows the `ftyp` box type.
  if (ascii(bytes, 4, 8) === "ftyp") {
    const brand = ascii(bytes, 8, 12);
    if (HEIC_BRANDS.has(brand)) return "image/heic";
    if (HEIF_BRANDS.has(brand)) return "image/heif";
  }

  // PDF: the header, which the spec puts at the very start of the file. Some
  // readers tolerate junk before it; accepting that here would mean accepting a
  // file that is something else first and a PDF second.
  if (ascii(bytes, 0, 5) === "%PDF-") return "application/pdf";

  return null;
}
