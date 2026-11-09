import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { normaliseImage, normalisedName } from "./images";

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
  return sharp(raw, { raw: { width: W, height: H, channels: 4 } })
    .png()
    .toBuffer();
}

const topLeft = async (buf: Buffer) =>
  sharp(buf).ensureAlpha().extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer();

describe("normaliseImage", () => {
  // JPEG has no alpha channel: a see-through receipt encoded as one comes out on solid black.
  it("keeps a see-through receipt see-through", async () => {
    const out = await normaliseImage(await png(0));

    expect(out.mimeType).toBe("image/png");
    const px = await topLeft(out.full);
    expect(px[3]).toBe(0);
    expect(
      await sharp(out.full)
        .stats()
        .then((s) => s.isOpaque),
    ).toBe(false);
  });

  // An alpha channel is not transparency (screenshots are PNGs with an opaque one), so the check reads pixels.
  it("still stores an opaque image as JPEG, alpha channel or not", async () => {
    const out = await normaliseImage(await png(255));

    expect(out.mimeType).toBe("image/jpeg");
    expect(
      await sharp(out.full)
        .metadata()
        .then((m) => m.format),
    ).toBe("jpeg");
  });

  // An iPhone photo: libvips cannot decode HEVC, so libheif does. The fixture is an 80x60 red rectangle from macOS `sips`.
  it("decodes a HEIC photo", async () => {
    const out = await normaliseImage(readFileSync(new URL("./images.test.heic", import.meta.url)));

    expect(out.mimeType).toBe("image/jpeg");
    const meta = await sharp(out.full).metadata();
    expect([meta.width, meta.height]).toEqual([80, 60]);
    const px = await topLeft(out.full);
    expect(px[0]).toBeGreaterThan(180);
    expect(px[1]).toBeLessThan(80);
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
