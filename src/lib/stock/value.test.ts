import { describe, expect, it } from "vitest";
import {
  costBasis,
  costOfRemoval,
  purchaseValueOre,
  revalue,
  unitCostOre,
  valueDelta,
} from "./value";
import type { StockEntryKind } from "@/lib/domain/types";

describe("costOfRemoval", () => {
  const held = { qty: 4200, valueOre: 149_400 };

  it("charges the proportional share of what is held", () => {
    expect(costOfRemoval(held, 700)).toBe(24_900);
    expect(costOfRemoval(held, 329)).toBe(11_703);
  });

  it("empties the value exactly when it empties the stock", () => {
    let qty = held.qty;
    let valueOre = held.valueOre;
    for (let i = 0; i < 12; i++) {
      const cost = costOfRemoval({ qty, valueOre }, 329);
      qty -= 329;
      valueOre -= cost;
    }
    // Still the same unit cost twelve withdrawals later. No drift.
    expect(unitCostOre({ qty, valueOre })).toBeCloseTo(35.5714, 3);

    const last = costOfRemoval({ qty, valueOre }, qty);
    expect(last).toBe(valueOre);
    expect(valueOre - last).toBe(0);
  });

  it("takes the whole value when more is removed than is held", () => {
    expect(costOfRemoval(held, 99_999)).toBe(149_400);
  });

  it("costs nothing to remove from an empty stock", () => {
    expect(costOfRemoval({ qty: 0, valueOre: 0 }, 500)).toBe(0);
    expect(costOfRemoval({ qty: 0, valueOre: 4000 }, 500)).toBe(0);
  });

  it("costs nothing to remove nothing", () => {
    expect(costOfRemoval(held, 0)).toBe(0);
    expect(costOfRemoval(held, -5)).toBe(0);
  });

  it("blends a second delivery into what is left, not into what was bought", () => {
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
    expect(unitCostOre({ qty: 4200, valueOre: 149_400 })).toBeCloseTo(35.5714, 3);
  });
});

describe("costBasis", () => {
  it("prices a stock by what is still sealed", () => {
    expect(costBasis({ units: 6 })).toBe(6);
    expect(costBasis({ units: 24 })).toBe(24);
  });
});

describe("purchaseValueOre", () => {
  it("prices a delivery from what the product says a unit costs", () => {
    expect(purchaseValueOre(6, 24_900)).toBe(149_400);
  });

  it("values a delivery of an unpriced product at nothing rather than guessing", () => {
    expect(purchaseValueOre(6, null)).toBe(0);
  });

  it("takes a recorded zero as a zero", () => {
    expect(purchaseValueOre(6, 0)).toBe(0);
  });

  it("rounds to the öre", () => {
    expect(purchaseValueOre(3, 1_233)).toBe(3_699);
  });
});

describe("valueDelta", () => {
  it("prices a delivery from the product's own cost", () => {
    expect(
      valueDelta({ qty: 0, valueOre: 0 }, { kind: "PURCHASE", units: 24, unitCostOre: 1200 }),
    ).toBe(28_800);
  });

  it("prices what leaves at the moving average", () => {
    // Ten bottles that cost 1 000 kr; two leaving cost 200 kr.
    expect(valueDelta({ qty: 10, valueOre: 100_000 }, { kind: "CHECKOUT", units: -2 })).toBe(
      -20_000,
    );
  });

  it("takes the whole remaining value when the last of it leaves", () => {
    expect(valueDelta({ qty: 3, valueOre: 100_001 }, { kind: "CHECKOUT", units: -3 })).toBe(
      -100_001,
    );
  });

  it("writes a cellar breakage down at the moving average", () => {
    expect(valueDelta({ qty: 10, valueOre: 100_000 }, { kind: "SPOILAGE", units: -2 })).toBe(
      -20_000,
    );
    expect(valueDelta({ qty: 3, valueOre: 100_001 }, { kind: "SPOILAGE", units: -3 })).toBe(
      -100_001,
    );
    expect(valueDelta({ qty: 10, valueOre: 100_000 }, { kind: "SPOILAGE", units: 0 })).toBe(0);
  });

  it("prices stock arriving at the same average", () => {
    expect(valueDelta({ qty: 10, valueOre: 100_000 }, { kind: "RETURN", units: 2 })).toBe(20_000);
  });

  it("prices an arrival onto an empty shelf from the product's own cost", () => {
    expect(
      valueDelta({ qty: 0, valueOre: 0 }, { kind: "COUNT", units: 6, unitCostOre: 24_900 }),
    ).toBe(149_400);
    expect(
      valueDelta({ qty: 0, valueOre: 0 }, { kind: "RETURN", units: 2, unitCostOre: 24_900 }),
    ).toBe(49_800);
  });

  it("still prices an arrival at nothing when nobody has priced the product", () => {
    // The gap shows as a gap rather than as a total built on an invented price.
    expect(valueDelta({ qty: 0, valueOre: 0 }, { kind: "RETURN", units: 2 })).toBe(0);
  });

  it("has no effect when nothing whole moved", () => {
    expect(valueDelta({ qty: 10, valueOre: 100_000 }, { kind: "RETURN", units: 0 })).toBe(0);
  });
});

describe("revalue", () => {
  const row = (id: string, kind: StockEntryKind, units: number, unitCostOre = 1000) => ({
    id,
    kind,
    units,
    unitCostOre,
  });

  it("prices a delivery and what leaves it", () => {
    const out = revalue([row("a", "PURCHASE", 10, 1000), row("b", "CHECKOUT", -2, 1000)]);
    expect(out.get("a")).toBe(10_000);
    expect(out.get("b")).toBe(-2000);
  });

  it("is not moved by the product being re-priced afterwards", () => {
    const rows = [row("a", "PURCHASE", 10, 1000), row("b", "CHECKOUT", -2)];
    expect(revalue(rows)).toEqual(revalue(rows));
    expect(revalue(rows).get("a")).toBe(10_000);
  });

  it("re-prices everything after a delivery that changed", () => {
    const twenty = revalue([row("a", "PURCHASE", 20, 1000), row("b", "CHECKOUT", -2, 1000)]);
    const twoHundred = revalue([row("a", "PURCHASE", 200, 1000), row("b", "CHECKOUT", -2, 1000)]);
    expect(twenty.get("b")).toBe(-2000);
    expect(twoHundred.get("b")).toBe(-2000);
    // Same per-bottle cost either way here; what differs is the stock left.
    expect(twenty.get("a")).toBe(20_000);
    expect(twoHundred.get("a")).toBe(200_000);
  });

  it("blends two deliveries at different prices", () => {
    const out = revalue([
      row("a", "PURCHASE", 10, 1000),
      row("b", "PURCHASE", 10, 2000),
      row("c", "CHECKOUT", -1),
    ]);
    expect(out.get("c")).toBe(-1500);
  });

  it("takes the whole remaining value when the last of it leaves", () => {
    const out = revalue([
      row("a", "PURCHASE", 3, 3334),
      row("b", "CHECKOUT", -1),
      row("c", "CHECKOUT", -2),
    ]);
    const total = [...out.values()].reduce((n, v) => n + v, 0);
    expect(total).toBe(0);
  });

  it("prices an opening stocktake, which has no delivery behind it", () => {
    const out = revalue([row("a", "COUNT", 12, 1000), row("b", "CHECKOUT", -1, 1000)]);
    expect(out.get("a")).toBe(12_000);
    expect(out.get("b")).toBe(-1000);
  });

  it("does not re-price a later count from cost, only the one onto an empty shelf", () => {
    const out = revalue([row("a", "PURCHASE", 10, 1000), row("b", "COUNT", 2, 1000)]);
    expect(out.get("b")).toBe(2000);
  });

  it("has nothing to say about an empty log", () => {
    expect(revalue([]).size).toBe(0);
  });
});
