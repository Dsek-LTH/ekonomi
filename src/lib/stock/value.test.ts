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
    // Still the same unit cost twelve withdrawals later. No drift.
    expect(unitCostOre({ qty, valueOre })).toBeCloseTo(35.5714, 3);

    const last = costOfRemoval({ qty, valueOre }, qty);
    expect(last).toBe(valueOre);
    expect(valueOre - last).toBe(0);
  });

  it("takes the whole value when more is removed than is held", () => {
    // Which is a mistake somewhere else, but it must not leave a residue of
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
    // new average is weighted by the 2 100 ml still on the shelf. Weighting it
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
    // A gap that shows up as a gap (a shelf worth nothing when it plainly is
    // not) instead of a total quietly built on an invented price.
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
    expect(valueDelta({ qty: 0, valueOre: 0 }, { kind: "PURCHASE", units: 24, unitCostOre: 1200 })).toBe(
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

  it("writes a cellar breakage down at the moving average", () => {
    // The whole reason a write-off in the cellar is its own kind rather than a
    // spill with no event: a spill at a pub moves no stock and so is worth
    // nothing here, and a bottle broken in the cellar has to cost the shelf
    // what the shelf paid for it. It needs no rule of its own to do that. It is
    // a removal, and every removal is priced this way.
    expect(valueDelta({ qty: 10, valueOre: 100_000 }, { kind: "SPOILAGE", units: -2 })).toBe(
      -20_000,
    );
    expect(valueDelta({ qty: 3, valueOre: 100_001 }, { kind: "SPOILAGE", units: -3 })).toBe(
      -100_001,
    );
    // An opened bottle is already worth nothing to the stock, so breaking one
    // writes nothing down. Its cost left the books when it was opened.
    expect(valueDelta({ qty: 10, valueOre: 100_000 }, { kind: "SPOILAGE", units: 0 })).toBe(0);
  });

  it("prices stock arriving at the same average", () => {
    // A bottle coming home unopened is worth what it was worth when it left;
    // pricing it at nothing would let a night out write the stock down.
    expect(valueDelta({ qty: 10, valueOre: 100_000 }, { kind: "RETURN", units: 2 })).toBe(20_000);
  });

  it("prices an arrival onto an empty shelf from the product's own cost", () => {
    // There is no average to apply, and zero is the answer that wrote the
    // opening stocktake in at nothing. Both ways of getting here are ordinary:
    // a cellar counted onto the shelf for the first time, and a night that took
    // every bottle out and brought some home.
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
    // Opening a bottle is `units` falling; moving one *between* rungs is not a
    // change of value at all.
    expect(valueDelta({ qty: 10, valueOre: 100_000 }, { kind: "RETURN", units: 0 })).toBe(0);
  });
});

describe("revalue", () => {
  // The cost rides on the row now, the way it does in the database: what a unit
  // cost when the movement was written, never what the product costs today.
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
    // The criterion the whole column exists for. Same rows, same captured
    // costs, so the same answer however often somebody corrects the product.
    const rows = [row("a", "PURCHASE", 10, 1000), row("b", "CHECKOUT", -2)];
    expect(revalue(rows)).toEqual(revalue(rows));
    // And a delivery booked at 10 kr stays booked at 10 kr, whatever the
    // product says today.
    expect(revalue(rows).get("a")).toBe(10_000);
  });

  it("re-prices everything after a delivery that changed", () => {
    // The reason this exists. Twenty bottles at 10 kr, two taken out: the two
    // cost 20 kr. Had the delivery been mistyped as 200 and then corrected, the
    // withdrawal must not stay priced against the 200.
    const twenty = revalue([row("a", "PURCHASE", 20, 1000), row("b", "CHECKOUT", -2, 1000)]);
    const twoHundred = revalue([row("a", "PURCHASE", 200, 1000), row("b", "CHECKOUT", -2, 1000)]);
    expect(twenty.get("b")).toBe(-2000);
    expect(twoHundred.get("b")).toBe(-2000);
    // Same per-bottle cost either way here; what differs is the stock left.
    expect(twenty.get("a")).toBe(20_000);
    expect(twoHundred.get("a")).toBe(200_000);
  });

  it("blends two deliveries at different prices", () => {
    // Ten at 10 kr and ten at 20 kr is twenty bottles worth 300 kr, so one
    // leaving costs 15 kr, the moving average, not either price.
    const out = revalue([
      row("a", "PURCHASE", 10, 1000),
      row("b", "PURCHASE", 10, 2000),
      row("c", "CHECKOUT", -1),
    ]);
    // Two deliveries at two prices, which is the case the row's own cost makes
    // expressible at all: twenty bottles worth 300 kr, so one leaving costs the
    // average of 15 kr and neither of the prices paid.
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
    // The production case this was got wrong for: a cellar entered with the
    // stocktake button rather than as deliveries. Counted in at 10 kr a bottle,
    // twelve bottles, and one leaving costs the same 10 kr.
    const out = revalue([row("a", "COUNT", 12, 1000), row("b", "CHECKOUT", -1, 1000)]);
    expect(out.get("a")).toBe(12_000);
    expect(out.get("b")).toBe(-1000);
  });

  it("does not re-price a later count from cost, only the one onto an empty shelf", () => {
    // The second count finds two more than the books say. They are worth the
    // average of what is already there, which is what the average is for.
    const out = revalue([row("a", "PURCHASE", 10, 1000), row("b", "COUNT", 2, 1000)]);
    expect(out.get("b")).toBe(2000);
  });

  it("has nothing to say about an empty log", () => {
    expect(revalue([]).size).toBe(0);
  });
});
