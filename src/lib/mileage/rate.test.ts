import { describe, expect, it } from "vitest";

import { distanceOre, rateOn } from "./rate";

const rates = [
  { orePerKm: 185, validFrom: "2019-01-01" },
  { orePerKm: 250, validFrom: "2023-01-01" },
  { orePerKm: 265, validFrom: "2027-01-01" },
];

describe("rateOn", () => {
  it("takes the newest rate that had already started", () => {
    expect(rateOn(rates, "2026-08-27")?.orePerKm).toBe(250);
  });

  it("counts the first day of a rate as inside it", () => {
    expect(rateOn(rates, "2023-01-01")?.orePerKm).toBe(250);
    expect(rateOn(rates, "2022-12-31")?.orePerKm).toBe(185);
  });

  it("does not apply a rate that has not started yet", () => {
    // A claim filed in 2026 is worth the 2026 rate even though the table
    // already knows what 2027 will be.
    expect(rateOn(rates, "2026-12-31")?.orePerKm).toBe(250);
    expect(rateOn(rates, "2027-01-01")?.orePerKm).toBe(265);
  });

  it("says nothing rather than inventing a rate for a day before the first", () => {
    // Not a fallback constant: a trip nobody can value must be refused, not
    // quietly paid out at whatever the code happened to hold.
    expect(rateOn(rates, "2018-06-01")).toBeNull();
    expect(rateOn([], "2026-08-27")).toBeNull();
  });

  it("does not care what order the rates arrive in", () => {
    const shuffled = [rates[2], rates[0], rates[1]];
    expect(rateOn(shuffled, "2026-08-27")?.orePerKm).toBe(250);
    expect(shuffled[0]).toBe(rates[2]); // and does not sort them under the caller
  });
});

describe("distanceOre", () => {
  it("values a distance at the rate", () => {
    expect(distanceOre(42, 250)).toBe(10500); // 105,00 kr
  });

  it("takes the tenths a trip meter reads", () => {
    expect(distanceOre(4.2, 250)).toBe(1050);
  });

  it("rounds half up, to the öre", () => {
    expect(distanceOre(0.1, 185)).toBe(19); // 18,5 öre
  });
});
