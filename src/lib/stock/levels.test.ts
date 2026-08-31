import { describe, expect, it } from "vitest";
import {
  bottlesAt,
  homecomingCount,
  openCount,
  openMl,
  pickFault,
  returnFault,
  shelfFromHomecoming,
  suggestPick,
  type BottleStock,
  type Homecoming,
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

describe("suggestPick", () => {
  it("empties the ladder from the top", () => {
    // The oldest opening is finished first, so a bottle does not sit at 20 %
    // forever while fuller ones keep being chosen.
    expect(suggestPick(shelf, 2)).toEqual({ sealed: 0, open: { 80: 1, 40: 1 } });
  });

  it("reaches for a sealed bottle only once every open one is coming", () => {
    expect(suggestPick(shelf, 4)).toEqual({ sealed: 1, open: { 80: 1, 40: 2 } });
  });

  it("never suggests something pickFault would refuse", () => {
    // The two are the same rule, one applied and one checked, so they had
    // better not disagree.
    for (let wanted = 0; wanted <= 10; wanted++) {
      expect(pickFault(shelf, suggestPick(shelf, wanted))).toBeNull();
    }
  });

  it("gives back what there is when asked for more", () => {
    expect(suggestPick(shelf, 99)).toEqual({ sealed: 6, open: { 80: 1, 40: 2 } });
  });

  it("gives back nothing when asked for nothing", () => {
    expect(suggestPick(shelf, 0)).toEqual({ sealed: 0, open: {} });
    expect(suggestPick(shelf, -3)).toEqual({ sealed: 0, open: {} });
  });
});

describe("returnFault", () => {
  const home = (h: Partial<Homecoming>): Homecoming => ({
    sealed: 0,
    open: {},
    emptied: 0,
    ...h,
  });

  it("accepts what actually went out", () => {
    expect(returnFault(3, home({ sealed: 1, open: { 40: 1 }, emptied: 1 }))).toBeNull();
  });

  it("accepts fewer coming home than went out", () => {
    // Two of the three are still at the pub. The rest can come back later.
    expect(returnFault(3, home({ open: { 60: 1 } }))).toBeNull();
  });

  it("refuses more bottles than were ever taken", () => {
    // The check the old from-dropdown could not make, and the reason it is
    // gone: nothing was tracking what had left.
    expect(returnFault(1, home({ sealed: 1, open: { 40: 1 } }))).toBe("moreThanWentOut");
    expect(returnFault(0, home({ sealed: 1 }))).toBe("moreThanWentOut");
  });

  it("refuses a return of nothing", () => {
    expect(returnFault(3, home({}))).toBe("nothingReturned");
  });

  it("counts an emptied bottle as come home", () => {
    // It closes the bottle that was out even though it puts nothing back. A
    // bottle finished at the pub is accounted for, not still outstanding.
    expect(homecomingCount(home({ emptied: 2 }))).toBe(2);
    expect(returnFault(2, home({ emptied: 2 }))).toBeNull();
  });
});

describe("shelfFromHomecoming", () => {
  it("puts back only the bottles that still hold something", () => {
    // The sealed ones are counted separately and the empties put back nothing,
    // so what lands on the ladder is the part-used ones alone.
    expect(
      shelfFromHomecoming({ sealed: 2, open: { 60: 1, 20: 1 }, emptied: 3 }),
    ).toEqual({ 60: 1, 20: 1 });
  });
});

describe("bottlesAt", () => {
  it("reads a rung nobody is on as none", () => {
    expect(bottlesAt(shelf.open, 60)).toBe(0);
    expect(bottlesAt(shelf.open, 40)).toBe(2);
  });
});
