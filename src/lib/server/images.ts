// Server-side image normalisation for uploaded receipts: HEIC/HEIF and huge photos become a web-friendly
// image with EXIF rotation applied. PDFs are not touched here. One stored size, no thumbnail.
import decodeHeic from "heic-decode";
import sharp, { type Sharp } from "sharp";

const IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);

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
 * A way to start a sharp pipeline on the upload. sharp's libvips cannot decode HEVC, so HEIC (iPhone) is
 * decoded by libheif in WebAssembly and handed over as raw pixels, which already carry the rotation
 * (the `.rotate()` below is then a no-op).
 */
async function open(input: Buffer): Promise<() => Sharp> {
  // A HEIC libvips cannot even read the header of goes to libheif too.
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

/** Whether the image actually shows through anywhere. `hasAlpha` alone is true for any PNG screenshot, so the costly `stats()` runs only when it says maybe. */
async function isTransparent(load: () => Sharp): Promise<boolean> {
  const { hasAlpha } = await load().metadata();
  if (!hasAlpha) return false;
  const { isOpaque } = await load().stats();
  return !isOpaque;
}

export async function normaliseImage(input: Buffer): Promise<NormalisedImage> {
  const load = await open(input);
  // `.rotate()` with no angle bakes in the EXIF orientation, then strips it.
  const base = load().rotate();

  // JPEG would composite a transparent image onto black, so anything transparent stays PNG.
  const transparent = await isTransparent(load);
  const mimeType: NormalisedMime = transparent ? "image/png" : "image/jpeg";

  const encode = (pipeline: Sharp, quality: number) =>
    transparent
      ? // No `palette`: it quantises to 256 colours, ruinous to a photograph.
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
const AVATAR_SIZE = 256;

// A profile picture from the member's crop (already square). WebP, throws if the bytes aren't decodable.
export async function avatarImage(input: Buffer): Promise<Buffer> {
  const load = await open(input);
  return load()
    .rotate()
    .resize({ width: AVATAR_SIZE, height: AVATAR_SIZE, fit: "cover" })
    .webp({ quality: 85 })
    .toBuffer();
}
