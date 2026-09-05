// Server-side image normalisation for uploaded receipts. Phone photos arrive in
// formats browsers can't always show (HEIC/HEIF) and at huge sizes; we convert
// them to a web-friendly image and fix EXIF rotation. PDFs are not touched here.
//
// There is one stored size and no thumbnail. There used to be a second, 480px
// encode written alongside it, and nothing ever asked for it. The viewer always
// read the full-size object, and no list shows a preview. It cost an extra
// encode on every upload and an extra object per receipt to produce something
// nobody looked at.
import sharp, { type Sharp } from "sharp";

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

/** What a normalised receipt can be stored as. */
type NormalisedMime = "image/jpeg" | "image/png";

interface NormalisedImage {
  full: Buffer; // display image (EXIF-rotated, downscaled)
  mimeType: NormalisedMime;
}

const MAX_FULL = 2400; // px on the longest side, plenty to zoom into details

const EXTENSION: Record<NormalisedMime, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
};

/**
 * Whether the image actually shows through anywhere.
 *
 * Two questions, and both have to be asked. `hasAlpha` is about the file's
 * channels, and a screenshot saved as PNG has an alpha channel whether or not a
 * single pixel uses it. Going by that alone would store every PNG receipt as a
 * PNG, which for a photographed receipt is several times the size of the JPEG
 * it should have been. `stats()` reads the pixels and answers whether any of
 * them is see-through, which is the question that matters; it is the expensive
 * one, so it is only asked when the cheap one has already said "maybe".
 */
async function isTransparent(input: Buffer): Promise<boolean> {
  const { hasAlpha } = await sharp(input).metadata();
  if (!hasAlpha) return false;
  const { isOpaque } = await sharp(input).stats();
  return !isOpaque;
}

// Turn an original image into a web-friendly one. Throws if the bytes aren't a
// decodable image.
export async function normaliseImage(input: Buffer): Promise<NormalisedImage> {
  // `.rotate()` with no angle bakes in the EXIF orientation, then strips it, so
  // the pixels are upright regardless of how the phone recorded them.
  const base = sharp(input, { failOn: "none" }).rotate();

  // JPEG has no alpha channel. Encoding a see-through image as one doesn't
  // fail, it composites the image onto sharp's default background (black),
  // so a receipt that looked right in the browser came back out of the archive
  // as white text on a black page. Anything transparent is kept as PNG, which
  // has the channel to keep. Everything else is still JPEG: it is the smaller
  // format, and for a photograph of a paper receipt there is nothing to keep.
  const transparent = await isTransparent(input);
  const mimeType: NormalisedMime = transparent ? "image/png" : "image/jpeg";

  const encode = (pipeline: Sharp, quality: number) =>
    transparent
      ? // No `palette`: it quantises to 256 colours, which is kind to a
        // screenshot and ruinous to a photograph, and this branch gets both.
        pipeline.png({ compressionLevel: 9 })
      : pipeline.jpeg({ quality, mozjpeg: true });

  const full = await encode(
    base.resize({ width: MAX_FULL, height: MAX_FULL, fit: "inside", withoutEnlargement: true }),
    82,
  ).toBuffer();

  return { full, mimeType };
}

/** Original filename with its extension swapped for the one actually stored. */
export function normalisedName(filename: string, mimeType: NormalisedMime): string {
  const base = filename.replace(/\.[^.]+$/, "");
  return `${base || "kvitto"}.${EXTENSION[mimeType]}`;
}
