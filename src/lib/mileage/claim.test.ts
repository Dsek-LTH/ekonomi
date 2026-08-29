import { describe, expect, it } from "vitest";

import { claimBlocker, journeyKm, valueJourney, type JourneyInput } from "./claim";

const rates = [
  { orePerKm: 185, validFrom: "2019-01-01" },
  { orePerKm: 250, validFrom: "2023-01-01" },
];

const journey = (over: Partial<JourneyInput> = {}): JourneyInput => ({
  date: "2026-08-11",
  odometerStart: 12300,
  odometerEnd: 12342,
  ...over,
});

describe("journeyKm", () => {
  it("is the difference between the two readings", () => {
    expect(journeyKm(12300, 12342)).toBe(42);
  });

  it("keeps the tenth a trip meter shows, without the float dust", () => {
    expect(journeyKm(12300.1, 12345.6)).toBe(45.5);
  });

  it("is nothing at all when a reading is missing", () => {
    expect(journeyKm(null, 12342)).toBeNull();
    expect(journeyKm(12300, null)).toBeNull();
  });

  it("refuses a journey that does not go forward", () => {
    // Equal readings are somebody who has not driven yet; a smaller end
    // reading is a mistyped digit or the two fields the wrong way round.
    // Neither is a distance, and taking an absolute value would quietly turn
    // one into a claim.
    expect(journeyKm(12300, 12300)).toBeNull();
    expect(journeyKm(12342, 12300)).toBeNull();
  });

  it("counts a reading of zero as a reading", () => {
    // A trip meter that was just zeroed, and a car straight off the lot.
    expect(journeyKm(0, 42)).toBe(42);
  });
});

describe("valueJourney", () => {
  it("values the distance at the day's rate", () => {
    const v = valueJourney(journey(), rates);
    expect(v.km).toBe(42);
    expect(v.orePerKm).toBe(250);
    expect(v.ore).toBe(10500); // 105,00 kr
  });

  it("takes the rate that was in force, not the newest one", () => {
    expect(valueJourney(journey({ date: "2022-12-28" }), rates).ore).toBe(42 * 185);
  });

  it("has no amount while the journey has no distance", () => {
    const v = valueJourney(journey({ odometerEnd: null }), rates);
    expect(v.km).toBeNull();
    expect(v.ore).toBeNull();
    // The rate is still known — the date alone decides it, and showing it is
    // how the form says what a kilometre will be worth before the readings are
    // in.
    expect(v.orePerKm).toBe(250);
  });

  it("has no rate for a day no rate covers", () => {
    expect(valueJourney(journey({ date: "2018-06-01" }), rates).orePerKm).toBeNull();
    expect(valueJourney(journey({ date: "2026-08" }), rates).orePerKm).toBeNull();
  });
});

describe("claimBlocker", () => {
  it("passes a journey that is filled in and priceable", () => {
    expect(claimBlocker(journey(), rates)).toBeNull();
  });

  it("asks for a reading that is missing", () => {
    expect(claimBlocker(journey({ odometerStart: null }), rates)).toBe("noReadings");
    expect(claimBlocker(journey({ odometerEnd: null }), rates)).toBe("noReadings");
  });

  it("names a journey that does not go forward as its own mistake", () => {
    // Said apart from "fill the readings in": both are there, and what is
    // wrong is which way round they are.
    expect(claimBlocker(journey({ odometerEnd: 12300 }), rates)).toBe("notForward");
    expect(claimBlocker(journey({ odometerStart: 12400 }), rates)).toBe("notForward");
  });

  it("refuses a day nobody has said what a kilometre is worth on", () => {
    expect(claimBlocker(journey({ date: "2018-06-01" }), rates)).toBe("noRate");
    expect(claimBlocker(journey(), [])).toBe("noRate");
  });

  it("reports what is fixed first", () => {
    expect(claimBlocker(journey({ odometerStart: null }), [])).toBe("noReadings");
  });
});
