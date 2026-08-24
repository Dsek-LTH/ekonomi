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
    expect(
      entryFault(entry({ kind: "RETURN", open: { 80: -1, 40: 1 } }), VOLUME),
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

  it("refuses a checkout that adds stock", () => {
    expect(entryFault(entry({ kind: "CHECKOUT", units: 12 }), UNIT)).toBe("removalNotNegative");
  });

  it("refuses a homecoming that takes stock away", () => {
    // A return only ever puts bottles back — the checkout took them off.
    expect(entryFault(entry({ kind: "RETURN", units: -1 }), UNIT)).toBe(
      "purchaseNotPositive",
    );
  });

  it("lets a count go either way", () => {
    // Which is the entire point of counting: the shelf is allowed to disagree
    // with the log in both directions.
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
    // A level is judged when a bottle is looked at, and a bottle is looked at
    // when it comes back. Everything else may take bottles off a rung; only a
    // return may put one on.
    expect(entryFault(entry({ kind: "CHECKOUT", open: { 40: 1 } }), VOLUME)).toBe(
      "levelsOnReturnOnly",
    );
    expect(entryFault(entry({ kind: "CHECKOUT", open: { 80: 1 } }), VOLUME)).toBe(
      "levelsOnReturnOnly",
    );
  });

  it("lets a count and a correction move a bottle up", () => {
    // A count is somebody standing at the shelf judging every bottle, which is
    // the same act as judging a returning one — and a correction exists to undo
    // whatever the log got wrong.
    expect(entryFault(entry({ kind: "COUNT", open: { 60: 1 } }), VOLUME)).toBeNull();
    expect(
      entryFault(entry({ kind: "CORRECTION", open: { 60: 1 }, correctsId: "x" }), VOLUME),
    ).toBeNull();
  });

  it("passes a delivery of sealed bottles", () => {
    expect(entryFault(entry({ kind: "PURCHASE", units: 6 }), VOLUME)).toBeNull();
  });

  it("refuses a delivery that arrives part-used", () => {
    // Everything bought arrives sealed. A purchase touching a rung is far more
    // likely to be somebody in the wrong form than a crate of half-drunk gin.
    //
    // Upward, the ladder rule catches it first and says the more useful thing —
    // a level is judged on a return, and this is not one.
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
    // Without a target it is just another movement, and the log loses the one
    // thing that made it a correction.
    expect(entryFault(entry({ kind: "CORRECTION", units: -1 }), UNIT)).toBe(
      "correctionNeedsTarget",
    );
    expect(entryFault(entry({ kind: "CORRECTION", units: -1, correctsId: "x" }), UNIT)).toBeNull();
  });
});

describe("entryFault, on a spill", () => {
  // A spill is the one kind that moves no stock: what was dropped left the
  // cellar when it was checked out, and taking it off the shelf again would
  // remove it twice. Its quantity lives in a column of its own, so every rule
  // about the shelf columns has to be answered before them rather than by them.
  it("accepts one that only says what was destroyed", () => {
    expect(entryFault({ kind: "WASTE", units: 0, spilledQty: 2 }, { kind: "UNIT" })).toBeNull();
  });

  it("does not read an untouched shelf as nothing happening", () => {
    // The bug this exists for: a spill fell through to the "moves nothing"
    // rule and every one of them came back as `nothingMoved`, because the row
    // was — correctly — moving no stock at all.
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
    expect(
      entryFault({ kind: "WASTE", units: -2, spilledQty: 2 }, { kind: "UNIT" }),
    ).toBe("spillMovesNoStock");
    expect(
      entryFault({ kind: "WASTE", units: 0, open: { 40: -1 }, spilledQty: 1 }, { kind: "VOLUME" }),
    ).toBe("spillMovesNoStock");
  });

  it("lets one be taken back", () => {
    // Undoing a spill somebody entered twice. It is the same shape pointing the
    // other way, and it needs no `reversal` flag: a spill has no sign rule,
    // having no stock to move.
    expect(entryFault({ kind: "WASTE", units: 0, spilledQty: -2 }, { kind: "UNIT" })).toBeNull();
  });
});
