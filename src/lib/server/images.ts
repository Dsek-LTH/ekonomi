// Server-side image normalisation for uploaded receipts. Phone photos arrive in
// formats browsers can't always show (HEIC/HEIF) and at huge sizes; we convert
// everything to a sensible JPEG, fix EXIF rotation, and make a small thumbnail.
// PDFs are not touched here.
import sharp from "sharp";

const IMAGE_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

export function isNormalisableImage(mime: string): boolean {
  return IMAGE_MIME.has(mime);
}

export interface NormalisedImage {
  full: Buffer; // display image (JPEG, EXIF-rotated, downscaled)
  thumb: Buffer; // small preview (JPEG)
  mimeType: "image/jpeg";
}

const MAX_FULL = 2400; // px on the longest side — plenty to zoom into details
const THUMB = 480; // px on the longest side

// Turn an original image into a web-friendly full image + thumbnail. Throws if
// the bytes aren't a decodable image.
export async function normaliseImage(input: Buffer): Promise<NormalisedImage> {
  // `.rotate()` with no angle bakes in the EXIF orientation, then strips it, so
  // the pixels are upright regardless of how the phone recorded them.
  const base = sharp(input, { failOn: "none" }).rotate();

  const full = await base
    .clone()
    .resize({ width: MAX_FULL, height: MAX_FULL, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();

  const thumb = await base
    .clone()
    .resize({ width: THUMB, height: THUMB, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 70, mozjpeg: true })
    .toBuffer();

  return { full, thumb, mimeType: "image/jpeg" };
}

// Original filename with its extension swapped to .jpg (we always store JPEG).
export function asJpegName(filename: string): string {
  const base = filename.replace(/\.[^.]+$/, "");
  return `${base || "kvitto"}.jpg`;
}
