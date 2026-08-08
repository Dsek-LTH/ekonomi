import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { normaliseImage, normalisedName } from "./images";

// Bytes in, bytes out — no storage and no database, so this belongs with the
// rest of the unit tests despite living under server/.

const W = 60;
const H = 60;

/** A red square whose top half carries the given alpha, as a PNG. */
function png(alphaTopHalf: number): Promise<Buffer> {
  const raw = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      raw[i] = 220;
      raw[i + 1] = 30;
      raw[i + 2] = 30;
      raw[i + 3] = y < H / 2 ? alphaTopHalf : 255;
    }
  }
  return sharp(raw, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
}

const topLeft = async (buf: Buffer) =>
  sharp(buf).ensureAlpha().extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer();

describe("normaliseImage", () => {
  // The bug this exists to stop: JPEG has no alpha channel, so a see-through
  // receipt encoded as one is composited onto sharp's default background and
  // comes back out of the archive on solid black.
  it("keeps a see-through receipt see-through", async () => {
    const out = await normaliseImage(await png(0));

    expect(out.mimeType).toBe("image/png");
    const px = await topLeft(out.full);
    expect(px[3]).toBe(0);
    expect(await sharp(out.full).stats().then((s) => s.isOpaque)).toBe(false);
  });

  // An alpha channel is not transparency. Screenshots are PNGs with a fully
  // opaque alpha channel, and storing those as PNG would cost several times the
  // JPEG for nothing — which is why the check reads pixels, not metadata.
  it("still stores an opaque image as JPEG, alpha channel or not", async () => {
    const out = await normaliseImage(await png(255));

    expect(out.mimeType).toBe("image/jpeg");
    expect(await sharp(out.full).metadata().then((m) => m.format)).toBe("jpeg");
  });

  it("names the file after what was actually stored", () => {
    expect(normalisedName("kvitto.png", "image/png")).toBe("kvitto.png");
    expect(normalisedName("kvitto.png", "image/jpeg")).toBe("kvitto.jpg");
    expect(normalisedName("skärmbild.HEIC", "image/jpeg")).toBe("skärmbild.jpg");
    expect(normalisedName(".png", "image/jpeg")).toBe("kvitto.jpg");
  });

  it("refuses bytes that aren't an image", async () => {
    await expect(normaliseImage(Buffer.from("inte en bild"))).rejects.toThrow();
  });
});
