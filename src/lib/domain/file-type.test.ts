import { describe, expect, it } from "vitest";
import { SNIFF_BYTES, sniffReceiptType } from "./file-type";

// Enough of a file to recognise it, padded to the length the sniffer may read.
const head = (...parts: (number[] | string)[]): Uint8Array => {
  const bytes = parts.flatMap((p) =>
    typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p,
  );
  return new Uint8Array([...bytes, ...Array(Math.max(0, SNIFF_BYTES - bytes.length)).fill(0)]);
};

const JPEG = head([0xff, 0xd8, 0xff, 0xe0]);
const PNG = head([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const WEBP = head("RIFF", [0x24, 0x00, 0x00, 0x00], "WEBP");
const HEIC = head([0, 0, 0, 0x18], "ftyp", "heic");
const HEIF = head([0, 0, 0, 0x18], "ftyp", "mif1");
const PDF = head("%PDF-1.7");

describe("sniffReceiptType", () => {
  it("recognises the formats a receipt may be", () => {
    expect(sniffReceiptType(JPEG)).toBe("image/jpeg");
    expect(sniffReceiptType(PNG)).toBe("image/png");
    expect(sniffReceiptType(WEBP)).toBe("image/webp");
    expect(sniffReceiptType(HEIC)).toBe("image/heic");
    expect(sniffReceiptType(HEIF)).toBe("image/heif");
    expect(sniffReceiptType(PDF)).toBe("application/pdf");
  });

  // The point of the whole module: the upload's declared Content-Type is a
  // claim, and these are the bytes that would otherwise be stored under it.
  it("refuses a file that only claims to be one", () => {
    expect(sniffReceiptType(head("<html><script>"))).toBeNull();
    expect(sniffReceiptType(head("<?xml version=", "'1.0'?><svg"))).toBeNull();
    expect(sniffReceiptType(head("#!/bin/sh\n"))).toBeNull();
    expect(sniffReceiptType(head([0x4d, 0x5a]))).toBeNull(); // MZ, a Windows executable
    expect(sniffReceiptType(head([0x50, 0x4b, 0x03, 0x04]))).toBeNull(); // a zip
  });

  it("refuses a PDF header that isn't at the start", () => {
    expect(sniffReceiptType(head("<html>%PDF-"))).toBeNull();
  });

  // A RIFF container can hold audio just as easily; the form type is the part
  // that says WebP.
  it("refuses RIFF that isn't WebP", () => {
    expect(sniffReceiptType(head("RIFF", [0x24, 0, 0, 0], "WAVE"))).toBeNull();
  });

  // Same container as HEIC, different brand, an MP4 is not a receipt.
  it("refuses an ISO base-media file that isn't a still image", () => {
    expect(sniffReceiptType(head([0, 0, 0, 0x18], "ftyp", "mp42"))).toBeNull();
    expect(sniffReceiptType(head([0, 0, 0, 0x18], "ftyp", "isom"))).toBeNull();
  });

  it("does not read past the end of a short file", () => {
    expect(sniffReceiptType(new Uint8Array([]))).toBeNull();
    expect(sniffReceiptType(new Uint8Array([0xff, 0xd8]))).toBeNull(); // truncated JPEG
    expect(sniffReceiptType(new Uint8Array([0x25, 0x50, 0x44]))).toBeNull(); // "%PD"
  });
});
