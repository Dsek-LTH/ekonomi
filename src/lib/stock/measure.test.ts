import { describe, expect, it } from "vitest";
import {
  calibrationFault,
  contentGrams,
  fullness,
  implausibleReading,
  readingToMl,
  readingsToMl,
  type Calibration,
} from "./measure";

// A 700 ml bottle: 450 g of glass, 1114 g full. 664 g of liquid for 700 ml,
// which is the ~0.95 g/ml of a 40 % spirit and the reason "1 g ≈ 1 ml" is a
// usable check at the scale.
const vodka: Calibration = { nominalMl: 700, tareGrams: 450, fullGrams: 1114 };

describe("calibrationFault", () => {
  it("passes a product that can actually be weighed", () => {
    expect(calibrationFault(vodka)).toBeNull();
  });

  it("refuses a product missing any of the three", () => {
    expect(calibrationFault(null)).toBe("calibrationMissing");
    expect(calibrationFault({})).toBe("calibrationMissing");
    expect(calibrationFault({ ...vodka, tareGrams: undefined })).toBe("calibrationMissing");
    // A UNIT product reaching this by mistake looks exactly like this.
    expect(calibrationFault({ nominalMl: 700 })).toBe("calibrationMissing");
  });

  it("refuses a full bottle that does not outweigh an empty one", () => {
    // Transposed constants — the classic typo, and the one that would produce
    // negative stock everywhere rather than an obvious error.
    expect(calibrationFault({ nominalMl: 700, tareGrams: 1114, fullGrams: 450 })).toBe(
      "calibrationNotHeavier",
    );
    expect(calibrationFault({ nominalMl: 700, tareGrams: 450, fullGrams: 450 })).toBe(
      "calibrationNotHeavier",
    );
  });

  it("refuses a bottle that holds nothing", () => {
    expect(calibrationFault({ ...vodka, nominalMl: 0 })).toBe("calibrationNoVolume");
  });
});

describe("readingsToMl", () => {
  it("reads a full bottle as its nominal volume", () => {
    expect(readingToMl(1114, vodka)).toBe(700);
  });

  it("reads an empty bottle as nothing", () => {
    expect(readingToMl(450, vodka)).toBe(0);
  });

  it("reads half a bottle as half", () => {
    expect(readingToMl(450 + 332, vodka)).toBe(350);
  });

  it("subtracts one tare per bottle, not one per weighing", () => {
    // The whole reason a reading is stored per bottle: three bottles at 700 ml
    // each is 2100 ml, and it only comes out that way if the count is in the
    // arithmetic.
    expect(readingsToMl([1114, 1114, 1114], vodka)).toBe(2100);
    // Not the same as weighing their combined mass as though it were one
    // bottle, which is what a pre-summed total would have to assume.
    expect(readingsToMl([1114 * 3], vodka)).not.toBe(2100);
  });

  it("adds up a mixed set of part-used bottles", () => {
    // 620 g, 90 g and 400 g of liquid over three bottles: 1110 g of liquid,
    // which at this bottle's 664 g per 700 ml is 1170 ml.
    expect(readingsToMl([450 + 620, 450 + 90, 450 + 400], vodka)).toBe(1170);
  });

  it("rounds the set once, not each bottle in it", () => {
    // The two differ by a millilitre here, and the set's answer is the right
    // one: three roundings accumulate an error the weighing never contained.
    // Worth pinning, because the obvious refactor — map each reading through
    // readingToMl and sum — quietly changes the number in the legal record.
    const readings = [450 + 620, 450 + 90, 450 + 400];
    const perBottle = readings.reduce((sum, g) => sum + readingToMl(g, vodka), 0);
    expect(perBottle).toBe(1171);
    expect(readingsToMl(readings, vodka)).toBe(1170);
  });

  it("has nothing to weigh when nothing is on the scale", () => {
    // Not zero bottles holding an unknown amount — zero bottles hold nothing,
    // and a product with no open bottles is the common case.
    expect(readingsToMl([], vodka)).toBe(0);
  });

  it("never returns a negative volume", () => {
    // A bottle lighter than its own tare: a drifting scale, or a tare taken
    // from a heavier bottle of an older design. Nothing is nothing — a negative
    // here would silently cancel real stock out of the total.
    expect(readingToMl(400, vodka)).toBe(0);
  });

  it("works the same for a bottle of a different size", () => {
    const gin: Calibration = { nominalMl: 500, tareGrams: 380, fullGrams: 855 };
    expect(readingToMl(855, gin)).toBe(500);
    expect(readingToMl(380, gin)).toBe(0);
  });
});

describe("contentGrams", () => {
  it("is the liquid a full bottle holds", () => {
    expect(contentGrams(vodka)).toBe(664);
  });
});

describe("implausibleReading", () => {
  it("accepts a full bottle and everything under it", () => {
    expect(implausibleReading(1114, vodka)).toBe(false);
    expect(implausibleReading(800, vodka)).toBe(false);
    expect(implausibleReading(450, vodka)).toBe(false);
  });

  it("accepts the few grams of glass variation within one product", () => {
    // ±10 g on this bottle is 1.5 % — a heavier-than-average bottle of the same
    // design must not be treated as a mistake, or the warning is noise.
    expect(implausibleReading(1124, vodka)).toBe(false);
    expect(implausibleReading(440, vodka)).toBe(false);
  });

  it("flags a bottle that reads heavier than it could possibly be", () => {
    // A supplier's new glass, or a tare from a different bottle: this reads as
    // 1180 ml in a 700 ml bottle, which is not a stock level, it is a mistake.
    expect(implausibleReading(1450, vodka)).toBe(true);
  });

  it("flags a bottle far below its own empty weight", () => {
    expect(implausibleReading(300, vodka)).toBe(true);
  });
});

describe("fullness", () => {
  it("is 1 at full and 0 at empty", () => {
    expect(fullness(1114, vodka)).toBe(1);
    expect(fullness(450, vodka)).toBe(0);
  });
});
