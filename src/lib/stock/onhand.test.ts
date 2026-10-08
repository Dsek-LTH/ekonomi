import { describe, expect, it } from "vitest";
import {
  alcoholPerKrona,
  impossible,
  onHand,
  pureAlcoholMl,
  purchasedMl,
  unitVolume,
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
  category: "OL",
  unitMl: 330,
  abv: 5.2,
};

const move = (m: Partial<StockMovement>): StockMovement => ({
  kind: "PURCHASE",
  units: 0,
  ...m,
});

describe("onHand", () => {
  it("has nothing on an empty log", () => {
    expect(onHand(cans, [])).toEqual({
      units: 0,
      open: {},
      openBottles: 0,
      totalMl: 0,
      valueOre: 0,
    });
  });

  it("counts a delivery and a night's serving", () => {
    const state = onHand(cans, [
      move({ kind: "PURCHASE", units: 120 }),
      move({ kind: "CHECKOUT", units: -83 }),
      move({ kind: "WASTE", units: -2 }),
    ]);
    expect(state.units).toBe(35);
    expect(state.totalMl).toBe(35 * 330);
  });

  it("keeps sealed bottles and open ones apart", () => {
    // Six sealed; one goes out and comes back opened at 60; another goes out
    // at 60 and comes back at 20.
    const state = onHand(vodka, [
      move({ kind: "PURCHASE", units: 6 }),
      move({ kind: "CHECKOUT", units: -1 }),
      move({ kind: "RETURN", open: { 60: 1 } }),
      move({ kind: "CHECKOUT", open: { 60: -1 } }),
      move({ kind: "RETURN", open: { 20: 1 } }),
    ]);
    expect(state.units).toBe(5);
    expect(state.open).toEqual({ 60: 0, 20: 1 });
    expect(state.openBottles).toBe(1);
  });

  it("adds the open bottles' estimated litres to the sealed ones' real ones", () => {
    // Five sealed at 700, plus one bottle judged a fifth full.
    const state = onHand(vodka, [move({ units: 5, open: { 20: 1 } })]);
    expect(state.totalMl).toBeCloseTo(5 * 700 + 140, 6);
  });

  it("values the sealed bottles and nothing else", () => {
    // Opening one is the sealed count falling with no purchase behind it, so
    // the write-off needs no rule of its own.
    const state = onHand(vodka, [
      move({ kind: "PURCHASE", units: 6, valueDeltaOre: 149_400 }),
      move({ kind: "CHECKOUT", units: -1, valueDeltaOre: -24_900 }),
      move({ kind: "RETURN", open: { 60: 1 } }),
    ]);
    expect(state.units).toBe(5);
    expect(state.openBottles).toBe(1);
    // The open bottle is worth nothing, however full it is.
    expect(state.valueOre).toBe(124_500);
  });

  it("does not care what order the log arrives in", () => {
    const log = [
      move({ kind: "PURCHASE", units: 120, valueDeltaOre: 90_000 }),
      move({ kind: "CHECKOUT", units: -83, valueDeltaOre: -62_250 }),
      move({ kind: "COUNT", units: 4 }),
    ];
    expect(onHand(cans, [...log].reverse())).toEqual(onHand(cans, log));
  });

  it("counts a stocktake's difference like any other movement", () => {
    expect(onHand(cans, [move({ kind: "COUNT", units: -6 })]).units).toBe(-6);
  });

  it("has no total for a product nobody has sized", () => {
    const unsized: StockSubject = { kind: "UNIT", category: "OL" };
    const state = onHand(unsized, [move({ units: 12 })]);
    expect(state.units).toBe(12);
    expect(state.totalMl).toBeNull();
  });
});

describe("impossible", () => {
  it("passes an ordinary shelf", () => {
    expect(impossible(vodka, onHand(vodka, [move({ units: 5, open: { 40: 1 } })]))).toBe(false);
    expect(impossible(cans, onHand(cans, [move({ units: 35 })]))).toBe(false);
  });

  it("catches negative stock, which is always a fault and never a fact", () => {
    expect(impossible(cans, onHand(cans, [move({ units: -1 })]))).toBe(true);
  });

  it("catches a rung gone negative", () => {
    // A bottle taken off a level the log never saw a bottle arrive at.
    expect(impossible(vodka, onHand(vodka, [move({ open: { 40: -1 } })]))).toBe(true);
  });

  it("accepts bottles that are open but empty of value", () => {
    // No sealed bottles and one open: nothing is worth anything, and that is
    // an ordinary Sunday rather than a fault.
    expect(impossible(vodka, onHand(vodka, [move({ open: { 20: 1 } })]))).toBe(false);
  });
});

describe("purchasedMl", () => {
  const year: StockMovement[] = [
    move({ kind: "PURCHASE", units: 24 }),
    move({ kind: "CHECKOUT", units: -20 }),
    move({ kind: "WASTE", units: -1 }),
    move({ kind: "COUNT", units: -1 }),
    move({ kind: "PURCHASE", units: 48 }),
  ];

  it("counts what was bought and nothing else", () => {
    // The number the form asks for is inkopt volym. Servings are turnover on
    // that form and waste is neither, so neither may reach this total.
    expect(purchasedMl(cans, year)).toBe((24 + 48) * 330);
  });

  it("counts a spirit's purchases by the bottle, since everything bought is sealed", () => {
    expect(purchasedMl(vodka, [move({ kind: "PURCHASE", units: 2 })])).toBe(1400);
  });

  it("refuses to guess for a product nobody has sized", () => {
    const unsized: StockSubject = { kind: "UNIT", category: "OL" };
    expect(purchasedMl(unsized, year)).toBeNull();
  });
});

describe("pureAlcoholMl", () => {
  it("is volume times strength", () => {
    expect(pureAlcoholMl(vodka, 700)).toBe(280);
    expect(pureAlcoholMl(cans, 330)).toBe(17);
  });

  it("has no answer for a product with no strength recorded", () => {
    expect(pureAlcoholMl({ kind: "UNIT", category: "OL" }, 500)).toBeNull();
  });
});

describe("alcoholPerKrona", () => {
  it("is pure alcohol per krona of one whole unit", () => {
    // 700 ml at 40 % is 280 ml pure alcohol; a bottle costing 200 kr gives
    // 28 cl for that money, so 0,14 cl for one krona of it.
    expect(alcoholPerKrona({ ...vodka, costPriceOre: 20_000 })).toBeCloseTo(0.14, 6);
  });

  it("has no answer without a strength, a size or a price", () => {
    expect(alcoholPerKrona({ kind: "UNIT", category: "OL", costPriceOre: 1000 })).toBeNull();
    expect(alcoholPerKrona({ ...cans, costPriceOre: null })).toBeNull();
  });

  it("treats a zero price as unpriced rather than dividing by it", () => {
    expect(alcoholPerKrona({ ...cans, costPriceOre: 0 })).toBeNull();
  });
});

describe("unitVolume", () => {
  it("reads a bottle from nominalMl and a can from unitMl", () => {
    expect(unitVolume(vodka)).toBe(700);
    expect(unitVolume(cans)).toBe(330);
  });

  it("treats a zero or missing size as unknown", () => {
    expect(unitVolume({ kind: "UNIT", category: "OL", unitMl: 0 })).toBeNull();
    expect(unitVolume({ kind: "VOLUME", category: "SPRITDRYCK" })).toBeNull();
  });
});
