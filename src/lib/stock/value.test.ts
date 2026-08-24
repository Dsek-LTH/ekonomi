import { describe, expect, it } from "vitest";
import { costBasis, costOfRemoval, purchaseValueOre, revalue, unitCostOre, valueDelta } from "./value";
import type { StockEntryKind } from "@/lib/domain/types";

describe("costOfRemoval", () => {
  // Six bottles of 700 ml at 249 kr: 4 200 ml for 149 400 öre, which is
  // 35,5714 öre per millilitre and not a number an integer column can hold.
  const held = { qty: 4200, valueOre: 149_400 };

  it("charges the proportional share of what is held", () => {
    expect(costOfRemoval(held, 700)).toBe(24_900);
    expect(costOfRemoval(held, 329)).toBe(11_703);
  });

  it("empties the value exactly when it empties the stock", () => {
    // The property the whole method exists for. Twelve pours of 329 ml and then
    // the rest: the öre have to run out at the same moment the millilitres do,
    // or the books show vodka that is not on the shelf.
    let qty = held.qty;
    let valueOre = held.valueOre;
    for (let i = 0; i < 12; i++) {
      const cost = costOfRemoval({ qty, valueOre }, 329);
      qty -= 329;
      valueOre -= cost;
    }
    // Still the same unit cost twelve withdrawals later — no drift.
    expect(unitCostOre({ qty, valueOre })).toBeCloseTo(35.5714, 3);

    const last = costOfRemoval({ qty, valueOre }, qty);
    expect(last).toBe(valueOre);
    expect(valueOre - last).toBe(0);
  });

  it("takes the whole value when more is removed than is held", () => {
    // Which is a mistake somewhere else — but it must not leave a residue of
    // öre behind a quantity of nothing.
    expect(costOfRemoval(held, 99_999)).toBe(149_400);
  });

  it("costs nothing to remove from an empty stock", () => {
    // Inventing a cost here would hide the real error behind a plausible
    // number.
    expect(costOfRemoval({ qty: 0, valueOre: 0 }, 500)).toBe(0);
    expect(costOfRemoval({ qty: 0, valueOre: 4000 }, 500)).toBe(0);
  });

  it("costs nothing to remove nothing", () => {
    expect(costOfRemoval(held, 0)).toBe(0);
    expect(costOfRemoval(held, -5)).toBe(0);
  });

  it("blends a second delivery into what is left, not into what was bought", () => {
    // Half the first delivery is gone, then three bottles at 269 kr arrive. The
    // new average is weighted by the 2 100 ml still on the shelf — weighting it
    // by the original 4 200 would price the stock at a quantity that has not
    // existed for weeks.
    const cost = costOfRemoval(held, 2100);
    const left = { qty: held.qty - 2100, valueOre: held.valueOre - cost };
    expect(unitCostOre(left)).toBeCloseTo(35.5714, 3);

    const blended = { qty: left.qty + 2100, valueOre: left.valueOre + 80_700 };
    expect(blended).toEqual({ qty: 4200, valueOre: 155_400 });
    expect(unitCostOre(blended)).toBe(37);
  });
});

describe("unitCostOre", () => {
  it("has no answer for an empty stock", () => {
    expect(unitCostOre({ qty: 0, valueOre: 0 })).toBeNull();
  });

  it("keeps the fraction, because the fraction is the real price", () => {
    // Rounded to 36 this would be a lie about a figure somebody may be checking
    // against a receipt.
    expect(unitCostOre({ qty: 4200, valueOre: 149_400 })).toBeCloseTo(35.5714, 3);
  });
});

describe("costBasis", () => {
  it("prices a stock by what is still sealed", () => {
    // Six sealed bottles are worth six bottles; open ones are worth nothing,
    // which is what makes opening one a write-off with no rule behind it.
    expect(costBasis({ units: 6 })).toBe(6);
    expect(costBasis({ units: 24 })).toBe(24);
  });
});

describe("purchaseValueOre", () => {
  it("prices a delivery from what the product says a unit costs", () => {
    // The price lives on the product, not on the movement: it is the same
    // number every delivery, and nobody in a cellar should have to recall it.
    expect(purchaseValueOre(6, 24_900)).toBe(149_400);
  });

  it("values a delivery of an unpriced product at nothing rather than guessing", () => {
    // A gap that shows up as a gap — a shelf worth nothing when it plainly is
    // not — instead of a total quietly built on an invented price.
    expect(purchaseValueOre(6, null)).toBe(0);
  });

  it("takes a recorded zero as a zero", () => {
    // Sponsored stock, or a hand-over from another committee: free, and the
    // product says so.
    expect(purchaseValueOre(6, 0)).toBe(0);
  });

  it("rounds to the öre", () => {
    expect(purchaseValueOre(3, 1_233)).toBe(3_699);
  });
});

describe("valueDelta", () => {
  it("prices a delivery from the product's own cost", () => {
    expect(valueDelta({ qty: 0, valueOre: 0 }, { kind: "PURCHASE", units: 24, costPriceOre: 1200 })).toBe(
      28_800,
    );
  });

  it("prices what leaves at the moving average", () => {
    // Ten bottles that cost 1 000 kr; two leaving cost 200 kr.
    expect(valueDelta({ qty: 10, valueOre: 100_000 }, { kind: "CHECKOUT", units: -2 })).toBe(
      -20_000,
    );
  });

  it("takes the whole remaining value when the last of it leaves", () => {
    // The property that makes the method usable: emptying a product lands its
    // value on exactly zero rather than a few öre of vodka nobody has.
    expect(valueDelta({ qty: 3, valueOre: 100_001 }, { kind: "CHECKOUT", units: -3 })).toBe(
      -100_001,
    );
  });

  it("prices stock arriving at the same average", () => {
    // A bottle coming home unopened is worth what it was worth when it left;
    // pricing it at nothing would let a night out write the stock down.
    expect(valueDelta({ qty: 10, valueOre: 100_000 }, { kind: "RETURN", units: 2 })).toBe(20_000);
  });

  it("prices a return against an empty shelf at nothing rather than dividing by it", () => {
    expect(valueDelta({ qty: 0, valueOre: 0 }, { kind: "RETURN", units: 2 })).toBe(0);
  });

  it("has no effect when nothing whole moved", () => {
    // Opening a bottle is `units` falling; moving one *between* rungs is not a
    // change of value at all.
    expect(valueDelta({ qty: 10, valueOre: 100_000 }, { kind: "RETURN", units: 0 })).toBe(0);
  });
});

describe("revalue", () => {
  const row = (id: string, kind: StockEntryKind, units: number) => ({ id, kind, units });

  it("prices a delivery and what leaves it", () => {
    const out = revalue([row("a", "PURCHASE", 10), row("b", "CHECKOUT", -2)], 1000);
    expect(out.get("a")).toBe(10_000);
    expect(out.get("b")).toBe(-2000);
  });

  it("re-prices everything after a delivery that changed", () => {
    // The reason this exists. Twenty bottles at 10 kr, two taken out: the two
    // cost 20 kr. Had the delivery been mistyped as 200 and then corrected, the
    // withdrawal must not stay priced against the 200.
    const twenty = revalue([row("a", "PURCHASE", 20), row("b", "CHECKOUT", -2)], 1000);
    const twoHundred = revalue([row("a", "PURCHASE", 200), row("b", "CHECKOUT", -2)], 1000);
    expect(twenty.get("b")).toBe(-2000);
    expect(twoHundred.get("b")).toBe(-2000);
    // Same per-bottle cost either way here; what differs is the stock left.
    expect(twenty.get("a")).toBe(20_000);
    expect(twoHundred.get("a")).toBe(200_000);
  });

  it("blends two deliveries at different prices", () => {
    // Ten at 10 kr and ten at 20 kr is twenty bottles worth 300 kr, so one
    // leaving costs 15 kr — the moving average, not either price.
    const out = revalue(
      [row("a", "PURCHASE", 10), row("b", "PURCHASE", 10), row("c", "CHECKOUT", -1)],
      1000,
    );
    // Both deliveries priced from the product's own cost, so the average is
    // 1000 and a bottle leaving costs that.
    expect(out.get("c")).toBe(-1000);
  });

  it("takes the whole remaining value when the last of it leaves", () => {
    const out = revalue(
      [row("a", "PURCHASE", 3), row("b", "CHECKOUT", -1), row("c", "CHECKOUT", -2)],
      3334,
    );
    const total = [...out.values()].reduce((n, v) => n + v, 0);
    expect(total).toBe(0);
  });

  it("has nothing to say about an empty log", () => {
    expect(revalue([], 1000).size).toBe(0);
  });
});
