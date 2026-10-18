import { describe, expect, it } from "vitest";
import { internalCode, internalNumber, isInternalCode, validGtin } from "./barcode";

describe("validGtin", () => {
  it("takes real barcodes", () => {
    expect(validGtin("7312040017072")).toBe(true); // EAN-13, a Swedish beer
    expect(validGtin("96385074")).toBe(true); // EAN-8
    expect(validGtin("036000291452")).toBe(true); // UPC-A
    expect(validGtin("10012345678902")).toBe(true); // GTIN-14
  });

  it("refuses made-up numbers whose check digit is wrong", () => {
    expect(validGtin("12345678")).toBe(false);
    expect(validGtin("7312040017073")).toBe(false);
  });

  it("refuses lengths GS1 does not issue, and anything but digits", () => {
    expect(validGtin("123456789")).toBe(false);
    expect(validGtin("73120400170a2")).toBe(false);
    expect(validGtin("")).toBe(false);
  });
});

describe("internal codes", () => {
  it("are valid EAN-13s under the 20 prefix, and read back to their number", () => {
    const code = internalCode(1);
    expect(code).toMatch(/^200000000001\d$/);
    expect(validGtin(code)).toBe(true);
    expect(isInternalCode(code)).toBe(true);
    expect(internalNumber(code)).toBe(1);
    expect(internalNumber(internalCode(4711))).toBe(4711);
  });

  it("are told apart from a manufacturer's code", () => {
    expect(isInternalCode("7312040017072")).toBe(false);
    expect(internalNumber("7312040017072")).toBeNull();
  });
});
