import { describe, expect, it } from "vitest";

import { claimBlocker, journeyKm, namedStops, valueJourney, type JourneyInput } from "./claim";

const rates = [
  { orePerKm: 185, validFrom: "2019-01-01" },
  { orePerKm: 250, validFrom: "2023-01-01" },
];

const journey = (over: Partial<JourneyInput> = {}): JourneyInput => ({
  date: "2026-08-11",
  odometerStart: 12300,
  odometerEnd: 12342,
  stops: ["Kårhuset, Lund", "Snabbgross", "Kårhuset, Lund"],
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
    // Equal readings (not driven yet) or a smaller end reading (typo or swapped fields) are not
    // distances; an absolute value would turn one into a claim.
    expect(journeyKm(12300, 12300)).toBeNull();
    expect(journeyKm(12342, 12300)).toBeNull();
  });

  it("counts a reading of zero as a reading", () => {
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
    // The rate is still known from the date alone, so the form can show it before the readings are in.
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
    // Both are there; what is wrong is which way round.
    expect(claimBlocker(journey({ odometerEnd: 12300 }), rates)).toBe("notForward");
    expect(claimBlocker(journey({ odometerStart: 12400 }), rates)).toBe("notForward");
  });

  it("refuses a day nobody has said what a kilometre is worth on", () => {
    expect(claimBlocker(journey({ date: "2018-06-01" }), rates)).toBe("noRate");
    expect(claimBlocker(journey(), [])).toBe("noRate");
  });

  it("asks where the journey went", () => {
    // Readings say a car moved; only the stops say it was the section's errand.
    expect(claimBlocker(journey({ stops: [] }), rates)).toBe("noRoute");
    expect(claimBlocker(journey({ stops: ["Kårhuset, Lund"] }), rates)).toBe("noRoute");
  });

  it("does not take whitespace for a place", () => {
    expect(claimBlocker(journey({ stops: ["Lund", "   "] }), rates)).toBe("noRoute");
    expect(claimBlocker(journey({ stops: ["\t", "\n"] }), rates)).toBe("noRoute");
  });

  it("takes two stops as a journey, however many more there are", () => {
    // Out and back is the same place twice, a route not a duplicate.
    expect(claimBlocker(journey({ stops: ["E-huset", "E-huset"] }), rates)).toBeNull();
    expect(
      claimBlocker(journey({ stops: ["E-huset", "Snabbgross", "Systembolaget", "Hem"] }), rates),
    ).toBeNull();
  });

  it("counts only the stops that name a place", () => {
    // An editor leaves a blank row behind when one is cleared; two real places is still a journey, one is not.
    expect(claimBlocker(journey({ stops: ["E-huset", "", "Hem"] }), rates)).toBeNull();
    expect(claimBlocker(journey({ stops: ["E-huset", "", ""] }), rates)).toBe("noRoute");
  });

  it("reports what is fixed first", () => {
    expect(claimBlocker(journey({ odometerStart: null }), [])).toBe("noReadings");
    expect(claimBlocker(journey({ stops: [], odometerStart: null }), [])).toBe("noRoute");
  });
});

describe("namedStops", () => {
  it("keeps the order and drops what names nothing", () => {
    expect(namedStops(["E-huset", "  ", "Snabbgross", ""])).toEqual(["E-huset", "Snabbgross"]);
  });

  it("trims what it keeps, so a stray space is not a different place", () => {
    expect(namedStops([" E-huset ", "Hem"])).toEqual(["E-huset", "Hem"]);
  });

  it("keeps a place repeated, which is how a round trip is written", () => {
    expect(namedStops(["E-huset", "Snabbgross", "E-huset"])).toHaveLength(3);
  });
});
