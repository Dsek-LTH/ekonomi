import { describe, expect, it } from "vitest";
import { oreToSEK, parseOre, parseSEK, sekToOre } from "./money";

describe("oreToSEK", () => {
  it("divides by 100", () => {
    expect(oreToSEK(12345)).toBe(123.45);
    expect(oreToSEK(100)).toBe(1);
    expect(oreToSEK(1)).toBe(0.01);
  });

  it("keeps the sign of a return", () => {
    expect(oreToSEK(-25000)).toBe(-250);
  });

  it("treats a missing amount as zero rather than NaN", () => {
    // Nullable columns reach this straight from Prisma, and a NaN here would
    // propagate silently into a sum.
    expect(oreToSEK(null)).toBe(0);
    expect(oreToSEK(undefined)).toBe(0);
  });
});

describe("sekToOre", () => {
  it("multiplies by 100 and rounds to an integer", () => {
    expect(sekToOre(123.45)).toBe(12345);
    expect(sekToOre(-250)).toBe(-25000);
    expect(sekToOre(null)).toBe(0);
  });

  it("survives the float multiplications that öre storage exists to avoid", () => {
    // 19.99 * 100 is 1998.9999999999998 in binary floating point. Without the
    // rounding this is where a one-öre discrepancy enters the ledger.
    expect(sekToOre(19.99)).toBe(1999);
    expect(sekToOre(0.29)).toBe(29);
  });

  it("rounds a half-öre down, because the float is already below the half", () => {
    // 1.005 * 100 is 100.49999999999999, so Math.round gives 100 rather than
    // the 101 decimal arithmetic would. Pinned rather than fixed: an amount in
    // SEK has at most two decimals, so a half-öre never arrives from the UI or
    // from the bank — and "round half up on a value that isn't really a half"
    // would cost a decimal library for a case that cannot occur.
    expect(sekToOre(1.005)).toBe(100);
  });
});

describe("parseSEK", () => {
  it("reads the formats a Swedish keyboard produces", () => {
    expect(parseSEK("1234.50")).toBe(1234.5);
    expect(parseSEK("1234,50")).toBe(1234.5);
    expect(parseSEK("1 234,50")).toBe(1234.5);
    expect(parseSEK("1 234,50")).toBe(1234.5); // non-breaking space
  });

  it("reads a return as a negative amount", () => {
    expect(parseSEK("-250")).toBe(-250);
    expect(parseSEK("-1 234,50")).toBe(-1234.5);
  });

  it("falls back to zero on anything unreadable", () => {
    // The field is free text, so this runs on every keystroke of a half-typed
    // amount. Zero is what the submit gate then refuses to send.
    expect(parseSEK("")).toBe(0);
    expect(parseSEK("abc")).toBe(0);
    expect(parseSEK("-")).toBe(0);
  });
});

describe("parseOre", () => {
  it("goes from typed text straight to integer öre", () => {
    expect(parseOre("1 234,50")).toBe(123450);
    expect(parseOre("19,99")).toBe(1999);
    expect(parseOre("-250")).toBe(-25000);
  });
});

describe("round trip", () => {
  it("returns the same amount through öre and back", () => {
    for (const sek of [0, 1, 19.99, 123.45, -250, 1234.5, 0.01]) {
      expect(oreToSEK(sekToOre(sek))).toBe(sek);
    }
  });
});
