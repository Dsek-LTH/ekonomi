import { describe, expect, it } from "vitest";
import { entryFault, type ProposedEntry } from "./entry";

const UNIT = { kind: "UNIT" as const };
const VOLUME = { kind: "VOLUME" as const };

const entry = (e: Partial<ProposedEntry>): ProposedEntry => ({
  kind: "PURCHASE",
  units: 0,
  volumeMl: 0,
  openBottles: 0,
  ...e,
});

describe("entryFault", () => {
  it("passes a delivery of cans", () => {
    expect(entryFault(entry({ kind: "PURCHASE", units: 120 }), UNIT)).toBeNull();
  });

  it("passes a night's serving", () => {
    expect(entryFault(entry({ kind: "SERVING", units: -83 }), UNIT)).toBeNull();
  });

  it("passes a weighing that took liquid out of open bottles", () => {
    expect(
      entryFault(entry({ kind: "SERVING", volumeMl: -180, readings: [1070, 540] }), VOLUME),
    ).toBeNull();
  });

  it("refuses a row that moves nothing", () => {
    // It would sit in the log forever saying that on some date somebody moved
    // no vodka.
    expect(entryFault(entry({}), UNIT)).toBe("nothingMoved");
  });

  it("refuses a purchase that takes stock away", () => {
    // The sign is what everyone reading the log later goes by; a serving
    // entered as a purchase reads as a delivery.
    expect(entryFault(entry({ kind: "PURCHASE", units: -12 }), UNIT)).toBe(
      "purchaseNotPositive",
    );
  });

  it("refuses a serving or a spill that adds stock", () => {
    expect(entryFault(entry({ kind: "SERVING", units: 12 }), UNIT)).toBe("removalNotNegative");
    expect(entryFault(entry({ kind: "WASTE", units: 2 }), UNIT)).toBe("removalNotNegative");
  });

  it("lets a count go either way", () => {
    // Which is the entire point of counting: the shelf is allowed to disagree
    // with the log in both directions.
    expect(entryFault(entry({ kind: "COUNT", units: 4 }), UNIT)).toBeNull();
    expect(entryFault(entry({ kind: "COUNT", units: -6 }), UNIT)).toBeNull();
  });

  it("refuses millilitres against a product counted in cans", () => {
    // A can's volume is its count times what one holds. A millilitre figure
    // here is a form filled in against the wrong product.
    expect(entryFault(entry({ kind: "SERVING", volumeMl: -330 }), UNIT)).toBe(
      "volumeOnUnitProduct",
    );
    expect(entryFault(entry({ kind: "COUNT", units: 1, openBottles: 1 }), UNIT)).toBe(
      "volumeOnUnitProduct",
    );
  });

  it("refuses a weighing against a product counted in cans", () => {
    expect(entryFault(entry({ kind: "SERVING", units: -4, readings: [800] }), UNIT)).toBe(
      "readingsOnUnitProduct",
    );
  });

  it("refuses a body that states both a weighing and a volume", () => {
    // Two answers to one question, and nothing downstream could tell which was
    // meant. The route derives the volume from the readings.
    expect(
      entryFault(entry({ kind: "SERVING", volumeMl: -180, readings: [1070] }), VOLUME),
    ).toBe("readingsAndVolume");
  });

  it("refuses an open-bottle count that moves on its own", () => {
    // Opening a bottle moves a sealed one into the open count and its contents
    // with it. On its own it leaves liquid unaccounted for.
    expect(entryFault(entry({ kind: "CORRECTION", openBottles: 1 }), VOLUME)).toBe(
      "unitsOnVolumeOnly",
    );
  });

  it("passes opening a bottle, which moves all three at once", () => {
    expect(
      entryFault(
        entry({ kind: "CORRECTION", units: -1, openBottles: 1, volumeMl: 700, correctsId: null }),
        VOLUME,
      ),
    ).toBe("correctionNeedsTarget");
    // The same movement as a count, which needs no target.
    expect(
      entryFault(entry({ kind: "COUNT", units: -1, openBottles: 1, volumeMl: 700 }), VOLUME),
    ).toBeNull();
  });

  it("refuses a correction that names nothing", () => {
    // Without a target it is just another movement, and the log loses the one
    // thing that made it a correction.
    expect(entryFault(entry({ kind: "CORRECTION", units: -1 }), UNIT)).toBe(
      "correctionNeedsTarget",
    );
    expect(entryFault(entry({ kind: "CORRECTION", units: -1, correctsId: "x" }), UNIT)).toBeNull();
  });
});
