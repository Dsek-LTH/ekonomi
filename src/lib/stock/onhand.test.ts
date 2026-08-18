import { describe, expect, it } from "vitest";
import {
  belowMinimum,
  impossible,
  isReportedCategory,
  onHand,
  pureAlcoholMl,
  purchasedMl,
  unitVolume,
  wholeLitres,
  type StockMovement,
  type StockSubject,
} from "./onhand";

const vodka: StockSubject = {
  kind: "VOLUME",
  category: "SPRITDRYCK",
  nominalMl: 700,
  abv: 40,
};

const cans: StockSubject = {
  kind: "UNIT",
  category: "STARKOL",
  unitMl: 330,
  abv: 5.2,
};

const move = (m: Partial<StockMovement>): StockMovement => ({
  kind: "PURCHASE",
  units: 0,
  volumeMl: 0,
  openBottles: 0,
  ...m,
});

describe("onHand", () => {
  it("has nothing on an empty log", () => {
    expect(onHand(cans, [])).toEqual({ units: 0, openBottles: 0, openMl: 0, totalMl: 0 });
  });

  it("counts a delivery and a night's serving", () => {
    const state = onHand(cans, [
      move({ kind: "PURCHASE", units: 120 }),
      move({ kind: "SERVING", units: -83 }),
      move({ kind: "WASTE", units: -2 }),
    ]);
    expect(state.units).toBe(35);
    expect(state.totalMl).toBe(35 * 330);
  });

  it("keeps sealed bottles and open liquid apart", () => {
    // Twelve bottles in; one opened (a sealed bottle becomes an open one
    // holding its whole 700 ml); 120 ml poured out of it.
    const state = onHand(vodka, [
      move({ kind: "PURCHASE", units: 12 }),
      move({ kind: "CORRECTION", units: -1, openBottles: 1, volumeMl: 700 }),
      move({ kind: "SERVING", volumeMl: -120 }),
    ]);
    expect(state.units).toBe(11);
    expect(state.openBottles).toBe(1);
    expect(state.openMl).toBe(580);
    // Eleven sealed at 700 plus the 580 still in the open one.
    expect(state.totalMl).toBe(11 * 700 + 580);
  });

  it("does not care what order the log arrives in", () => {
    // A row entered late for an earlier date has to land in the same total as
    // one entered on the day, or every screen would depend on how the query
    // happened to sort.
    const log = [
      move({ kind: "PURCHASE", units: 120 }),
      move({ kind: "SERVING", units: -83 }),
      move({ kind: "COUNT", units: 4 }),
    ];
    expect(onHand(cans, [...log].reverse())).toEqual(onHand(cans, log));
  });

  it("counts a stocktake's difference like any other movement", () => {
    // What a count found is what the shelf has. It is the report that separates
    // the kinds, not the shelf.
    expect(onHand(cans, [move({ kind: "COUNT", units: -6 })]).units).toBe(-6);
  });

  it("has no total for a product nobody has sized", () => {
    // Better than reporting 0 ml for twelve real bottles.
    const unsized: StockSubject = { kind: "UNIT", category: "OVRIGT" };
    const state = onHand(unsized, [move({ units: 12 })]);
    expect(state.units).toBe(12);
    expect(state.totalMl).toBeNull();
  });
});

describe("impossible", () => {
  it("passes an ordinary shelf", () => {
    expect(impossible({ units: 11, openBottles: 1, openMl: 580, totalMl: 8280 })).toBe(false);
  });

  it("catches negative stock, which is always a fault and never a fact", () => {
    expect(impossible({ units: -1, openBottles: 0, openMl: 0, totalMl: -700 })).toBe(true);
    expect(impossible({ units: 0, openBottles: -1, openMl: 0, totalMl: 0 })).toBe(true);
    expect(impossible({ units: 0, openBottles: 1, openMl: -5, totalMl: -5 })).toBe(true);
  });

  it("catches liquid with no bottle to be in", () => {
    // What a mis-typed weighing looks like: the bottles were closed out but the
    // millilitres were not.
    expect(impossible({ units: 3, openBottles: 0, openMl: 240, totalMl: 2340 })).toBe(true);
  });

  it("accepts an open bottle that has just been emptied", () => {
    // 0 ml in one open bottle is a real state — the bottle is on the bar,
    // empty, and has not been thrown out yet.
    expect(impossible({ units: 3, openBottles: 1, openMl: 0, totalMl: 2100 })).toBe(false);
  });
});

describe("belowMinimum", () => {
  it("says nothing when nobody set a level", () => {
    expect(belowMinimum({ units: 0, openBottles: 0, openMl: 0, totalMl: 0 }, null)).toBe(false);
  });

  it("measures a sized product by its volume", () => {
    const state = onHand(vodka, [move({ units: 2 })]);
    expect(belowMinimum(state, 2100)).toBe(true);
    expect(belowMinimum(state, 1400)).toBe(false);
  });

  it("falls back to units for a product with no volume", () => {
    const unsized: StockSubject = { kind: "UNIT", category: "OVRIGT" };
    expect(belowMinimum(onHand(unsized, [move({ units: 3 })]), 5)).toBe(true);
  });
});

describe("purchasedMl", () => {
  const year: StockMovement[] = [
    move({ kind: "PURCHASE", units: 24 }),
    move({ kind: "SERVING", units: -20 }),
    move({ kind: "WASTE", units: -1 }),
    move({ kind: "COUNT", units: -1 }),
    move({ kind: "PURCHASE", units: 48 }),
  ];

  it("counts what was bought and nothing else", () => {
    // The number the form asks for is inkopt volym. Servings are turnover on
    // that form and waste is neither, so neither may reach this total.
    expect(purchasedMl(cans, year)).toBe((24 + 48) * 330);
  });

  it("counts liquid bought as part of a bottle purchase too", () => {
    // Rare, but real: half a bottle taken over from another committee arrives
    // as volume rather than as a sealed unit.
    expect(purchasedMl(vodka, [move({ kind: "PURCHASE", units: 2, volumeMl: 350 })])).toBe(1750);
  });

  it("refuses to guess for a product nobody has sized", () => {
    const unsized: StockSubject = { kind: "UNIT", category: "OVRIGT" };
    expect(purchasedMl(unsized, year)).toBeNull();
  });
});

describe("wholeLitres", () => {
  it("rounds to the whole litre the form asks for", () => {
    expect(wholeLitres(23760)).toBe(24);
    expect(wholeLitres(4600)).toBe(5);
    expect(wholeLitres(4400)).toBe(4);
  });
});

describe("pureAlcoholMl", () => {
  it("is volume times strength", () => {
    expect(pureAlcoholMl(vodka, 700)).toBe(280);
    expect(pureAlcoholMl(cans, 330)).toBe(17);
  });

  it("has no answer for a product with no strength recorded", () => {
    expect(pureAlcoholMl({ kind: "UNIT", category: "OVRIGT" }, 500)).toBeNull();
  });
});

describe("isReportedCategory", () => {
  it("covers the five the form wants a purchase volume for", () => {
    expect(isReportedCategory("SPRITDRYCK")).toBe(true);
    expect(isReportedCategory("VIN")).toBe(true);
    expect(isReportedCategory("ANDRA_JASTA")).toBe(true);
    expect(isReportedCategory("STARKOL")).toBe(true);
    expect(isReportedCategory("ALKOHOLDRYCKSLIKNANDE")).toBe(true);
  });

  it("leaves out the ones the form only asks turnover for, and our own", () => {
    expect(isReportedCategory("FOLKOL")).toBe(false);
    expect(isReportedCategory("LATTDRYCK")).toBe(false);
    expect(isReportedCategory("OVRIGT")).toBe(false);
  });
});

describe("unitVolume", () => {
  it("reads a bottle from nominalMl and a can from unitMl", () => {
    expect(unitVolume(vodka)).toBe(700);
    expect(unitVolume(cans)).toBe(330);
  });

  it("treats a zero or missing size as unknown", () => {
    expect(unitVolume({ kind: "UNIT", category: "OVRIGT", unitMl: 0 })).toBeNull();
    expect(unitVolume({ kind: "VOLUME", category: "SPRITDRYCK" })).toBeNull();
  });
});
