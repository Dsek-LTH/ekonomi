import { describe, expect, it } from "vitest";
import {
  movementVolume,
  spillVolume,
  tagTotals,
  unaccounted,
  type TagMovement,
  type TagSubject,
} from "./tag";

const cans: TagSubject = { kind: "UNIT", unitMl: 330 };
const vodka: TagSubject = { kind: "VOLUME", nominalMl: 700 };

const move = (m: Partial<TagMovement>): TagMovement => ({
  kind: "CHECKOUT",
  units: 0,
  ...m,
});

describe("movementVolume", () => {
  it("counts cans by the can, keeping the log's sign", () => {
    expect(movementVolume(cans, move({ units: -120 }))).toBe(-120);
  });

  it("counts a spirit in millilitres, so a part-used bottle is not a whole one", () => {
    // The reason spirits are not counted in bottles: one bottle out and one
    // bottle back is zero difference, and 420 ml of vodka is missing.
    expect(movementVolume(vodka, move({ units: -1 }))).toBe(-700);
    expect(movementVolume(vodka, move({ units: 0, open: { 40: 1 } }))).toBe(280);
  });

  it("adds the sealed bottles to the open ones", () => {
    expect(movementVolume(vodka, move({ units: -2, open: { 80: -1, 20: -1 } }))).toBe(
      -(1400 + 560 + 140),
    );
  });

  it("does care which way the signs point", () => {
    // It used to fold by magnitude, which was safe while a checkout was always
    // stored negative. The event sheet writes a checkout the other way round to
    // unwind one, so direction is now the whole of what distinguishes them.
    expect(movementVolume(cans, move({ units: 120 }))).toBe(
      -movementVolume(cans, move({ units: -120 })),
    );
  });
});

describe("spillVolume", () => {
  it("counts a dropped can as a can", () => {
    expect(spillVolume(cans, move({ kind: "WASTE", spilledQty: 2 }))).toBe(2);
  });

  it("costs a dropped sealed bottle its whole contents", () => {
    expect(spillVolume(vodka, move({ kind: "WASTE", spilledQty: 1 }))).toBe(700);
  });

  it("costs a dropped open bottle everything that was left in it", () => {
    // Which is the point of storing the rung: dropping a 40 % bottle loses
    // 280 ml, not a bottle and not a guess.
    expect(spillVolume(vodka, move({ kind: "WASTE", spilledQty: 1, level: 40 }))).toBe(280);
    expect(spillVolume(vodka, move({ kind: "WASTE", spilledQty: 2, level: 20 }))).toBe(280);
  });

  it("follows the sign, so a spill can be taken back", () => {
    expect(spillVolume(vodka, move({ kind: "WASTE", spilledQty: -1, level: 40 }))).toBe(-280);
  });
});

describe("tagTotals", () => {
  it("works out a night of cans", () => {
    // 120 out, 37 home, 2 dropped: 81 sold.
    const totals = tagTotals(cans, [
      move({ kind: "CHECKOUT", units: -120 }),
      move({ kind: "RETURN", units: 37 }),
      move({ kind: "WASTE", spilledQty: 2 }),
    ]);
    expect(totals).toEqual({ out: 120, back: 37, spilled: 2, sold: 81 });
  });

  it("adds up two takeouts of one night", () => {
    // The case a date cannot answer: a pub that ran past midnight, restocked
    // at one in the morning. Both belong to the tag, so both count.
    const totals = tagTotals(cans, [
      move({ kind: "CHECKOUT", units: -120 }),
      move({ kind: "CHECKOUT", units: -48 }),
      move({ kind: "RETURN", units: 30 }),
    ]);
    expect(totals.out).toBe(168);
    expect(totals.sold).toBe(138);
  });

  it("works out a night of spirits in millilitres", () => {
    // A sealed bottle out, back at 40 %: 420 ml sold.
    const totals = tagTotals(vodka, [
      move({ kind: "CHECKOUT", units: -1 }),
      move({ kind: "RETURN", open: { 40: 1 }, units: 0 }),
    ]);
    expect(totals).toEqual({ out: 700, back: 280, spilled: 0, sold: 420 });
  });

  it("charges a dropped open bottle to the night at what was left in it", () => {
    // Two bottles out, one dropped while 40 % full. Nothing came home, so the
    // night used 700 + 280 and lost the other 280 to the floor.
    const totals = tagTotals(vodka, [
      move({ kind: "CHECKOUT", units: -2 }),
      move({ kind: "WASTE", spilledQty: 1, level: 40 }),
    ]);
    expect(totals).toEqual({ out: 1400, back: 0, spilled: 280, sold: 1120 });
  });

  it("counts a bottle that never came back as sold in full", () => {
    expect(tagTotals(vodka, [move({ kind: "CHECKOUT", units: -1 })]).sold).toBe(700);
  });

  it("lets a checkout be taken back", () => {
    // Somebody typed 1 200 into the out cell and meant 120. The correction is a
    // checkout pointing the other way, and the column has to fall by it rather
    // than climb — which is the whole reason this folds by direction.
    const totals = tagTotals(cans, [
      move({ kind: "CHECKOUT", units: -1200 }),
      move({ kind: "CHECKOUT", units: 1080 }),
    ]);
    expect(totals.out).toBe(120);
    expect(totals.sold).toBe(120);
  });

  it("lets a return and a spill be taken back the same way", () => {
    const totals = tagTotals(cans, [
      move({ kind: "CHECKOUT", units: -120 }),
      move({ kind: "RETURN", units: 40 }),
      move({ kind: "RETURN", units: -3 }),
      move({ kind: "WASTE", spilledQty: 5 }),
      move({ kind: "WASTE", spilledQty: -3 }),
    ]);
    expect(totals).toEqual({ out: 120, back: 37, spilled: 2, sold: 81 });
  });

  it("leaves a delivery and a stocktake out of it", () => {
    // Neither belongs to a night, and neither may reach the arithmetic even if
    // something ever tags one.
    const totals = tagTotals(cans, [
      move({ kind: "CHECKOUT", units: -120 }),
      move({ kind: "PURCHASE", units: 240 }),
      move({ kind: "COUNT", units: -3 }),
    ]);
    expect(totals).toEqual({ out: 120, back: 0, spilled: 0, sold: 120 });
  });

  it("has nothing to say about a tag nothing has been booked on", () => {
    expect(tagTotals(cans, [])).toEqual({ out: 0, back: 0, spilled: 0, sold: 0 });
  });

  it("floors at nothing rather than reporting a negative sale", () => {
    // More home than ever left is a correction somebody made by hand, not a
    // night that sold minus four cans.
    const totals = tagTotals(cans, [
      move({ kind: "CHECKOUT", units: -10 }),
      move({ kind: "RETURN", units: 14 }),
    ]);
    expect(totals.sold).toBe(0);
  });
});

describe("unaccounted", () => {
  it("is what may still come home, and what a return is capped by", () => {
    const totals = tagTotals(cans, [
      move({ kind: "CHECKOUT", units: -120 }),
      move({ kind: "RETURN", units: 37 }),
      move({ kind: "WASTE", spilledQty: 2 }),
    ]);
    expect(unaccounted(totals)).toBe(81);
  });

  it("is nothing once everything is accounted for", () => {
    const totals = tagTotals(cans, [
      move({ kind: "CHECKOUT", units: -10 }),
      move({ kind: "RETURN", units: 10 }),
    ]);
    expect(unaccounted(totals)).toBe(0);
  });
});
