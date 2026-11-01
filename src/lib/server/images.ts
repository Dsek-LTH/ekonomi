// Server-side image normalisation for uploaded receipts. Phone photos arrive in
// formats browsers can't always show (HEIC/HEIF) and at huge sizes; we convert
// them to a web-friendly image and fix EXIF rotation. PDFs are not touched here.
//
// There is one stored size and no thumbnail. There used to be a second, 480px
// encode written alongside it, and nothing ever asked for it. The viewer always
// read the full-size object, and no list shows a preview. It cost an extra
// encode on every upload and an extra object per receipt to produce something
// nobody looked at.
import decodeHeic from "heic-decode";
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
 * A way to start a sharp pipeline on the upload, one call per pipeline.
 *
 * An iPhone photo is HEIC, which is HEVC inside, and sharp's prebuilt libvips
 * cannot decode HEVC (patents keep it out; only AVIF's codec is built in). It
 * reads the header fine and fails on the pixels, so every HEIC upload came back
 * "unreadable". Those are decoded by libheif compiled to WebAssembly instead
 * and handed to sharp as raw pixels. libheif applies the container's rotation
 * itself, and the raw pixels carry no EXIF, so the `.rotate()` below is then a
 * no-op rather than a second turn.
 */
async function open(input: Buffer): Promise<() => Sharp> {
  // A HEIC libvips will not even read the header of (one holding more images
  // than its limits allow, say) goes to libheif too. Anything else that throws
  // here is not a HEIC, and decodeHeic says so by throwing in turn.
  const meta = await sharp(input)
    .metadata()
    .catch(() => null);
  if (meta && (meta.format !== "heif" || meta.compression !== "hevc")) {
    return () => sharp(input, { failOn: "none" });
  }
  const { width, height, data } = await decodeHeic({ buffer: input });
  const pixels = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  return () => sharp(pixels, { raw: { width, height, channels: 4 } });
}

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
async function isTransparent(load: () => Sharp): Promise<boolean> {
  const { hasAlpha } = await load().metadata();
  if (!hasAlpha) return false;
  const { isOpaque } = await load().stats();
  return !isOpaque;
}

// Turn an original image into a web-friendly one. Throws if the bytes aren't a
// decodable image.
export async function normaliseImage(input: Buffer): Promise<NormalisedImage> {
  const load = await open(input);
  // `.rotate()` with no angle bakes in the EXIF orientation, then strips it, so
  // the pixels are upright regardless of how the phone recorded them.
  const base = load().rotate();

  // JPEG has no alpha channel. Encoding a see-through image as one doesn't
  // fail, it composites the image onto sharp's default background (black),
  // so a receipt that looked right in the browser came back out of the archive
  // as white text on a black page. Anything transparent is kept as PNG, which
  // has the channel to keep. Everything else is still JPEG: it is the smaller
  // format, and for a photograph of a paper receipt there is nothing to keep.
  const transparent = await isTransparent(load);
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

/** The side of a stored profile picture, in px. */
export const AVATAR_SIZE = 256;

// A profile picture, from whatever the member cropped. The crop dialog already
// sends a square, so `cover` only matters for a request that did not come from
// it. WebP, since it is only ever shown in a browser, and at this size it is a
// few kilobytes. Throws if the bytes aren't a decodable image.
export async function avatarImage(input: Buffer): Promise<Buffer> {
  const load = await open(input);
  return load()
    .rotate()
    .resize({ width: AVATAR_SIZE, height: AVATAR_SIZE, fit: "cover" })
    .webp({ quality: 85 })
    .toBuffer();
}
