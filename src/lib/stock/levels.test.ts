import { describe, expect, it } from "vitest";
import {
  bottlesAt,
  openCount,
  openMl,
  pickFault,
  shortfall,
  type BottleStock,
} from "./levels";

// The shelf in the examples: one bottle three-quarters gone, two half gone, six
// still sealed.
const shelf: BottleStock = { sealed: 6, open: { 80: 1, 40: 2 } };

describe("openCount", () => {
  it("counts every open bottle whatever rung it is on", () => {
    expect(openCount(shelf.open)).toBe(3);
    expect(openCount({})).toBe(0);
  });
});

describe("openMl", () => {
  it("takes each bottle for the fraction it was called", () => {
    // 0.8 + 0.4 + 0.4 of a 700 ml bottle.
    expect(openMl(shelf.open, 700)).toBeCloseTo(1120, 6);
  });

  it("has nothing in nothing", () => {
    expect(openMl({}, 700)).toBe(0);
  });
});

describe("pickFault", () => {
  it("lets the open bottles go", () => {
    expect(pickFault(shelf, { sealed: 0, open: { 40: 1 } })).toBeNull();
    expect(pickFault(shelf, { sealed: 0, open: { 80: 1, 40: 2 } })).toBeNull();
  });

  it("refuses a sealed bottle while an open one stays behind", () => {
    // The rule the bar asked for: the dregs leave with you, or the fresh
    // bottle stays. Otherwise the shelf fills with quarter-full bottles nobody
    // will ever pick over a new one.
    expect(pickFault(shelf, { sealed: 1, open: {} })).toBe("openBottlesFirst");
    expect(pickFault(shelf, { sealed: 1, open: { 80: 1 } })).toBe("openBottlesFirst");
    expect(pickFault(shelf, { sealed: 1, open: { 80: 1, 40: 1 } })).toBe("openBottlesFirst");
  });

  it("lets a sealed bottle go once every open one is going too", () => {
    // Taking the last of the open ones *with* you is the whole point. It is
    // not "wait until the shelf is clear", it is "take them along".
    expect(pickFault(shelf, { sealed: 2, open: { 80: 1, 40: 2 } })).toBeNull();
  });

  it("lets sealed bottles go when nothing is open", () => {
    expect(pickFault({ sealed: 6, open: {} }, { sealed: 3, open: {} })).toBeNull();
  });

  it("refuses more bottles than are on the shelf", () => {
    expect(pickFault(shelf, { sealed: 0, open: { 40: 3 } })).toBe("notThatManyOpen");
    // A rung nobody has anything on.
    expect(pickFault(shelf, { sealed: 0, open: { 60: 1 } })).toBe("notThatManyOpen");
    expect(pickFault({ sealed: 1, open: {} }, { sealed: 2, open: {} })).toBe(
      "notThatManySealed",
    );
  });

  it("checks what is there before it checks the order", () => {
    // Asking for a rung that does not exist is a plainer mistake than the
    // ordering rule, and saying so first is more use than "open bottles first"
    // about a bottle nobody has.
    expect(pickFault(shelf, { sealed: 1, open: { 60: 1 } })).toBe("notThatManyOpen");
  });
});

describe("bottlesAt", () => {
  it("reads a rung nobody is on as none", () => {
    expect(bottlesAt(shelf.open, 60)).toBe(0);
    expect(bottlesAt(shelf.open, 40)).toBe(2);
  });
});


describe("shortfall", () => {
  // Availability alone. What `pickFault` adds to it is a rule about choosing,
  // and nobody chooses which bottle falls off a shelf.
  it("does not make the dregs go first", () => {
    // The case it exists for: a sealed bottle broken in the cellar while a
    // 20 % one stands beside it. `pickFault` refuses this, rightly, for stock
    // being carried to a pub. Refusing it for a breakage would ask somebody to
    // write down a different accident from the one that happened.
    expect(pickFault(shelf, { sealed: 1, open: {} })).toBe("openBottlesFirst");
    expect(shortfall(shelf, { sealed: 1, open: {} })).toBeNull();
  });

  it("still refuses bottles the shelf has not got", () => {
    expect(shortfall(shelf, { sealed: 7, open: {} })).toBe("notThatManySealed");
    expect(shortfall(shelf, { sealed: 0, open: { 40: 3 } })).toBe("notThatManyOpen");
    expect(shortfall(shelf, { sealed: 0, open: { 60: 1 } })).toBe("notThatManyOpen");
  });
});
