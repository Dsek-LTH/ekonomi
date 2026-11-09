import { describe, expect, it } from "vitest";
import { bottlesAt, openCount, openMl, pickFault, shortfall, type BottleStock } from "./levels";

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
    expect(pickFault(shelf, { sealed: 1, open: {} })).toBe("openBottlesFirst");
    expect(pickFault(shelf, { sealed: 1, open: { 80: 1 } })).toBe("openBottlesFirst");
    expect(pickFault(shelf, { sealed: 1, open: { 80: 1, 40: 1 } })).toBe("openBottlesFirst");
  });

  it("lets a sealed bottle go once every open one is going too", () => {
    expect(pickFault(shelf, { sealed: 2, open: { 80: 1, 40: 2 } })).toBeNull();
  });

  it("lets sealed bottles go when nothing is open", () => {
    expect(pickFault({ sealed: 6, open: {} }, { sealed: 3, open: {} })).toBeNull();
  });

  it("refuses more bottles than are on the shelf", () => {
    expect(pickFault(shelf, { sealed: 0, open: { 40: 3 } })).toBe("notThatManyOpen");
    // A rung nobody has anything on.
    expect(pickFault(shelf, { sealed: 0, open: { 60: 1 } })).toBe("notThatManyOpen");
    expect(pickFault({ sealed: 1, open: {} }, { sealed: 2, open: {} })).toBe("notThatManySealed");
  });

  it("checks what is there before it checks the order", () => {
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
  it("does not make the dregs go first", () => {
    expect(pickFault(shelf, { sealed: 1, open: {} })).toBe("openBottlesFirst");
    expect(shortfall(shelf, { sealed: 1, open: {} })).toBeNull();
  });

  it("still refuses bottles the shelf has not got", () => {
    expect(shortfall(shelf, { sealed: 7, open: {} })).toBe("notThatManySealed");
    expect(shortfall(shelf, { sealed: 0, open: { 40: 3 } })).toBe("notThatManyOpen");
    expect(shortfall(shelf, { sealed: 0, open: { 60: 1 } })).toBe("notThatManyOpen");
  });
});
