import { describe, expect, it } from "vitest";
import { entryFault, type ProposedEntry } from "./entry";

const UNIT = { kind: "UNIT" as const };
const VOLUME = { kind: "VOLUME" as const };

const entry = (e: Partial<ProposedEntry>): ProposedEntry => ({
  kind: "PURCHASE",
  units: 0,
  ...e,
});

describe("entryFault", () => {
  it("passes a delivery of cans", () => {
    expect(entryFault(entry({ kind: "PURCHASE", units: 120 }), UNIT)).toBeNull();
  });

  it("passes stock going out to a pub", () => {
    expect(entryFault(entry({ kind: "CHECKOUT", units: -83 }), UNIT)).toBeNull();
  });

  it("passes an open bottle being taken out", () => {
    expect(entryFault(entry({ kind: "CHECKOUT", open: { 40: -1 } }), VOLUME)).toBeNull();
  });

  it("passes a bottle coming back a rung lower", () => {
    // One leaving 80 and arriving at 40, which is what a return is.
    expect(entryFault(entry({ kind: "RETURN", open: { 80: -1, 40: 1 } }), VOLUME)).toBeNull();
  });

  it("refuses a row that moves nothing", () => {
    expect(entryFault(entry({}), UNIT)).toBe("nothingMoved");
  });

  it("refuses a purchase that takes stock away", () => {
    expect(entryFault(entry({ kind: "PURCHASE", units: -12 }), UNIT)).toBe("purchaseNotPositive");
  });

  it("refuses a checkout that adds stock", () => {
    expect(entryFault(entry({ kind: "CHECKOUT", units: 12 }), UNIT)).toBe("removalNotNegative");
  });

  it("refuses a homecoming that takes stock away", () => {
    // A return only ever puts bottles back. The checkout took them off.
    expect(entryFault(entry({ kind: "RETURN", units: -1 }), UNIT)).toBe("purchaseNotPositive");
  });

  it("lets a count go either way", () => {
    expect(entryFault(entry({ kind: "COUNT", units: 4 }), UNIT)).toBeNull();
    expect(entryFault(entry({ kind: "COUNT", units: -6 }), UNIT)).toBeNull();
  });

  it("refuses a fill level against a product counted in cans", () => {
    // A can is never half a can.
    expect(entryFault(entry({ kind: "RETURN", open: { 40: 1 } }), UNIT)).toBe(
      "volumeOnUnitProduct",
    );
  });

  it("refuses putting a bottle onto the ladder anywhere but a return", () => {
    expect(entryFault(entry({ kind: "CHECKOUT", open: { 40: 1 } }), VOLUME)).toBe(
      "levelsOnReturnOnly",
    );
    expect(entryFault(entry({ kind: "CHECKOUT", open: { 80: 1 } }), VOLUME)).toBe(
      "levelsOnReturnOnly",
    );
  });

  it("lets a count and a correction move a bottle up", () => {
    expect(entryFault(entry({ kind: "COUNT", open: { 60: 1 } }), VOLUME)).toBeNull();
    expect(
      entryFault(entry({ kind: "CORRECTION", open: { 60: 1 }, correctsId: "x" }), VOLUME),
    ).toBeNull();
  });

  it("passes a delivery of sealed bottles", () => {
    expect(entryFault(entry({ kind: "PURCHASE", units: 6 }), VOLUME)).toBeNull();
  });

  it("refuses a delivery that arrives part-used", () => {
    expect(entryFault(entry({ kind: "PURCHASE", units: 6, open: { 40: 1 } }), VOLUME)).toBe(
      "levelsOnReturnOnly",
    );
    expect(entryFault(entry({ kind: "PURCHASE", units: 6, open: { 40: -1 } }), VOLUME)).toBe(
      "purchaseArrivesSealed",
    );
  });

  it("lets bottles leave empty, which is how a bottle ends", () => {
    expect(entryFault(entry({ kind: "COUNT", open: { 20: -1 } }), VOLUME)).toBeNull();
  });

  it("refuses a correction that names nothing", () => {
    expect(entryFault(entry({ kind: "CORRECTION", units: -1 }), UNIT)).toBe(
      "correctionNeedsTarget",
    );
    expect(entryFault(entry({ kind: "CORRECTION", units: -1, correctsId: "x" }), UNIT)).toBeNull();
  });
});

describe("entryFault, on a spill", () => {
  it("accepts one that only says what was destroyed", () => {
    expect(entryFault({ kind: "WASTE", units: 0, spilledQty: 2 }, { kind: "UNIT" })).toBeNull();
  });

  it("does not read an untouched shelf as nothing happening", () => {
    expect(entryFault({ kind: "WASTE", units: 0, spilledQty: 1 }, { kind: "VOLUME" })).not.toBe(
      "nothingMoved",
    );
  });

  it("insists it destroyed something", () => {
    expect(entryFault({ kind: "WASTE", units: 0, spilledQty: 0 }, { kind: "UNIT" })).toBe(
      "nothingSpilled",
    );
    expect(entryFault({ kind: "WASTE", units: 0 }, { kind: "UNIT" })).toBe("nothingSpilled");
  });

  it("refuses one that also moves the shelf", () => {
    // Both columns filled in would take the stock away twice.
    expect(entryFault({ kind: "WASTE", units: -2, spilledQty: 2 }, { kind: "UNIT" })).toBe(
      "spillMovesNoStock",
    );
    expect(
      entryFault({ kind: "WASTE", units: 0, open: { 40: -1 }, spilledQty: 1 }, { kind: "VOLUME" }),
    ).toBe("spillMovesNoStock");
  });

  it("lets one be taken back", () => {
    expect(entryFault({ kind: "WASTE", units: 0, spilledQty: -2 }, { kind: "UNIT" })).toBeNull();
  });
});

describe("entryFault, on a cellar write-off", () => {
  it("takes stock off the shelf", () => {
    expect(entryFault({ kind: "SPOILAGE", units: -2 }, { kind: "UNIT" })).toBeNull();
    expect(
      entryFault({ kind: "SPOILAGE", units: 0, open: { 40: -1 } }, { kind: "VOLUME" }),
    ).toBeNull();
  });

  it("insists on the sign its meaning fixes", () => {
    expect(entryFault({ kind: "SPOILAGE", units: 2 }, { kind: "UNIT" })).toBe("removalNotNegative");
    expect(entryFault({ kind: "SPOILAGE", units: 0, open: { 40: 1 } }, { kind: "VOLUME" })).toBe(
      "levelsOnReturnOnly",
    );
  });

  it("is not a row that moves nothing", () => {
    expect(entryFault({ kind: "SPOILAGE", units: 0 }, { kind: "UNIT" })).toBe("nothingMoved");
  });

  it("has no ladder on a can", () => {
    expect(entryFault({ kind: "SPOILAGE", units: 0, open: { 40: -1 } }, { kind: "UNIT" })).toBe(
      "volumeOnUnitProduct",
    );
  });
});
