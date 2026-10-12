import { describe, expect, it } from "vitest";
import { linePricing, rentalPricing, type PricedLine } from "./pricing";

const line = (over: Partial<PricedLine> = {}): PricedLine => ({
  quantity: 2,
  unitPriceOre: 25_000,
  discountPercent: 0,
  ...over,
});

describe("linePricing", () => {
  it("multiplies the line out before anything comes off", () => {
    expect(linePricing(line())).toEqual({
      grossOre: 50_000,
      discountPercent: 0,
      discountOre: 0,
      netOre: 50_000,
    });
  });

  it("takes the percentage off the whole line", () => {
    expect(linePricing(line({ discountPercent: 50 }))).toEqual({
      grossOre: 50_000,
      discountPercent: 50,
      discountOre: 25_000,
      netOre: 25_000,
    });
  });

  it("lends a line for nothing at 100 per cent, which is how a free loan is written", () => {
    expect(linePricing(line({ discountPercent: 100 }))).toEqual({
      grossOre: 50_000,
      discountPercent: 100,
      discountOre: 50_000,
      netOre: 0,
    });
  });

  it("rounds once, on the line, so quantity does not move the error", () => {
    // 3 × 3,33 kr = 9,99 kr, a third off. Rounding a discounted unit price
    // first would give 3 × 222 = 666 öre and a total of 333; rounding the line
    // gives 333 off 999, which is the figure anybody checking would arrive at.
    expect(linePricing({ quantity: 3, unitPriceOre: 333, discountPercent: 33 })).toEqual({
      grossOre: 999,
      discountPercent: 33,
      discountOre: 330,
      netOre: 669,
    });
  });

  it("clamps a percentage outside the range rather than refusing it", () => {
    expect(linePricing(line({ discountPercent: 140 })).discountPercent).toBe(100);
    expect(linePricing(line({ discountPercent: -20 })).discountPercent).toBe(0);
  });

  it("treats a half-typed number as nothing rather than NaN", () => {
    // The form holds these as strings, so an empty box arrives as NaN. One of
    // them must not turn the whole total into "NaN kr" while somebody types.
    expect(linePricing(line({ quantity: NaN })).grossOre).toBe(0);
    expect(linePricing(line({ unitPriceOre: NaN })).grossOre).toBe(0);
    expect(linePricing(line({ discountPercent: NaN })).discountPercent).toBe(0);
  });
});

describe("rentalPricing", () => {
  const lines = [
    line({ quantity: 2, unitPriceOre: 25_000 }),
    line({ quantity: 1, unitPriceOre: 15_000 }),
  ];

  it("adds the lines up and charges the lot when nothing is discounted", () => {
    expect(rentalPricing(lines)).toEqual({
      subtotalOre: 65_000,
      discountOre: 0,
      totalOre: 65_000,
      anyDiscount: false,
    });
  });

  it("discounts each line on its own terms", () => {
    // The speakers at half because they are going to another section, the mixer
    // at full because it is not.
    expect(
      rentalPricing([
        line({ quantity: 2, unitPriceOre: 25_000, discountPercent: 50 }),
        line({ quantity: 1, unitPriceOre: 15_000, discountPercent: 0 }),
      ]),
    ).toEqual({
      subtotalOre: 65_000,
      discountOre: 25_000,
      totalOre: 40_000,
      anyDiscount: true,
    });
  });

  it("lends the whole rental for nothing when every line is fully discounted", () => {
    expect(rentalPricing(lines.map((l) => ({ ...l, discountPercent: 100 })))).toEqual({
      subtotalOre: 65_000,
      discountOre: 65_000,
      totalOre: 0,
      anyDiscount: true,
    });
  });

  it("never charges less than nothing", () => {
    const p = rentalPricing(lines.map((l) => ({ ...l, discountPercent: 200 })));
    expect(p.totalOre).toBe(0);
  });

  it("holds on an empty form", () => {
    expect(rentalPricing([])).toEqual({
      subtotalOre: 0,
      discountOre: 0,
      totalOre: 0,
      anyDiscount: false,
    });
  });
});
