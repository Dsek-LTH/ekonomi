import { describe, expect, it } from "vitest";
import {
  WHOLE,
  cellFault,
  cellKey,
  cellQty,
  cellTotals,
  cellValue,
  entryColumns,
  rowOf,
  totalsFromCells,
  type CellRow,
  type SheetState,
} from "./cells";
import { tagTotals, type TagSubject } from "./event";

const cans: TagSubject = { kind: "UNIT", unitMl: 330 };
const vodka: TagSubject = { kind: "VOLUME", nominalMl: 700 };

const stored = (r: Partial<CellRow>): CellRow => ({
  productId: "p1",
  kind: "CHECKOUT",
  level: WHOLE,
  units: 0,
  ...r,
});

const out = (level = WHOLE) => ({ productId: "p1", kind: "CHECKOUT" as const, level });
const back = (level = WHOLE) => ({ productId: "p1", kind: "RETURN" as const, level });
const spill = (level = WHOLE) => ({ productId: "p1", kind: "WASTE" as const, level });

describe("cellQty", () => {
  it("reads a checkout back as a positive count", () => {
    // Nobody types a minus sign into a column headed "Ut".
    expect(cellQty(stored({ units: -120 }))).toBe(120);
  });

  it("reads a rung off its own column", () => {
    expect(cellQty(stored({ level: 40, open: { 40: -2 } }))).toBe(2);
    expect(cellQty(stored({ kind: "RETURN", level: 80, open: { 80: 3 } }))).toBe(3);
  });

  it("reads a spill off its own figure", () => {
    expect(cellQty(stored({ kind: "WASTE", level: 40, spilledQty: 2 }))).toBe(2);
  });
});

describe("entryColumns", () => {
  it("takes a checkout off the shelf", () => {
    expect(entryColumns(out(), 120)).toMatchObject({ units: -120, spilledQty: 0 });
  });

  it("puts a return on it", () => {
    expect(entryColumns(back(), 37)).toMatchObject({ units: 37 });
  });

  it("names the rung it is about", () => {
    expect(entryColumns(out(40), 2).open).toEqual({ 40: -2 });
    expect(entryColumns(back(80), 1).open).toEqual({ 80: 1 });
  });

  it("moves no stock for a spill", () => {
    // What was dropped left the cellar when it was checked out. Taking it off
    // the shelf again would remove it twice.
    expect(entryColumns(spill(40), 2)).toEqual({ units: 0, open: {}, spilledQty: 2 });
  });

  it("round-trips through cellQty, which is what makes a cell a row", () => {
    for (const ref of [out(), out(40), back(80), spill(20)]) {
      expect(cellQty(rowOf(ref, 7))).toBe(7);
    }
  });
});

describe("cellTotals", () => {
  it("gives one figure per row", () => {
    const totals = cellTotals([
      stored({ units: -120 }),
      stored({ kind: "RETURN", units: 37 }),
      stored({ kind: "WASTE", spilledQty: 2 }),
    ]);
    expect(cellValue(totals, out())).toBe(120);
    expect(cellValue(totals, back())).toBe(37);
    expect(cellValue(totals, spill())).toBe(2);
  });

  it("keeps out and in apart at the same rung", () => {
    // A bottle leaves sealed and comes home at 40 %. The two are not a pair.
    const totals = cellTotals([
      stored({ units: -1 }),
      stored({ kind: "RETURN", level: 40, open: { 40: 1 } }),
    ]);
    expect(cellValue(totals, out(WHOLE))).toBe(1);
    expect(cellValue(totals, back(WHOLE))).toBe(0);
    expect(cellValue(totals, back(40))).toBe(1);
  });

  it("reads a cell nothing is booked on as nought", () => {
    expect(cellValue(cellTotals([]), out())).toBe(0);
  });
});

describe("totalsFromCells", () => {
  const cellsOf = (...rows: CellRow[]) => cellTotals(rows);

  it("folds a night of cans", () => {
    const totals = totalsFromCells(
      cans,
      "p1",
      cellsOf(
        stored({ units: -120 }),
        stored({ kind: "RETURN", units: 37 }),
        stored({ kind: "WASTE", spilledQty: 2 }),
      ),
    );
    expect(totals).toEqual({ out: 120, back: 37, spilled: 2, sold: 81 });
  });

  it("counts a spirit in millilitres", () => {
    // A sealed bottle out, back at 40 %: 420 ml gone.
    const totals = totalsFromCells(
      vodka,
      "p1",
      cellsOf(stored({ units: -1 }), stored({ kind: "RETURN", level: 40, open: { 40: 1 } })),
    );
    expect(totals).toEqual({ out: 700, back: 280, spilled: 0, sold: 420 });
  });

  it("charges a dropped open bottle what was left in it", () => {
    const totals = totalsFromCells(
      vodka,
      "p1",
      cellsOf(stored({ units: -2 }), stored({ kind: "WASTE", level: 40, spilledQty: 1 })),
    );
    expect(totals).toMatchObject({ spilled: 280, sold: 1120 });
  });

  it("agrees with the fold over stored rows, which is the point of it", () => {
    const rows = [
      stored({ units: -3 }),
      stored({ level: 60, open: { 60: -2 } }),
      stored({ kind: "RETURN", level: 40, open: { 40: 2 } }),
      stored({ kind: "WASTE", level: 80, spilledQty: 1 }),
    ];
    expect(totalsFromCells(vodka, "p1", cellTotals(rows))).toEqual(tagTotals(vodka, rows));
  });

  it("leaves other products out of it", () => {
    const totals = cellTotals([
      stored({ productId: "p1", units: -10 }),
      stored({ productId: "p2", units: -99 }),
    ]);
    expect(totalsFromCells(cans, "p1", totals).out).toBe(10);
  });
});

/**
 * A sheet with nothing unsaved on it: what it reads and what the log holds are
 * the same map.
 *
 * Which is what every case below describes but one, and that one is the point:
 * see "cellFault, before anything is saved".
 */
const saved = (cells: Map<string, number>): SheetState => ({ sheet: cells, booked: cells });

describe("cellFault", () => {
  const shelf = { sealed: 200, open: {} };
  const nothing = new Map<string, number>();

  it("allows what the shelf can give up", () => {
    expect(cellFault(cans, shelf, saved(nothing), out(), 120)).toBeNull();
  });

  it("refuses more than the shelf holds", () => {
    expect(cellFault(cans, shelf, saved(nothing), out(), 240)).toBe("notThatManySealed");
  });

  it("refuses a rung the cellar has nothing on", () => {
    const bottles = { sealed: 4, open: { 80: 1 } };
    expect(cellFault(vodka, bottles, saved(nothing), out(60), 1)).toBe("notThatManyOpen");
    expect(cellFault(vodka, bottles, saved(nothing), out(80), 1)).toBeNull();
  });

  it("keeps the bar's rule that open bottles leave first", () => {
    const bottles = { sealed: 5, open: { 20: 1 } };
    expect(cellFault(vodka, bottles, saved(nothing), out(WHOLE), 1)).toBe("openBottlesFirst");
  });

  it("does not apply that rule to a bottle coming back", () => {
    // Putting one on the shelf is never the choice the rule guards against.
    const bottles = { sealed: 5, open: { 20: 1 } };
    const cells = cellTotals([stored({ units: -2 })]);
    expect(cellFault(vodka, bottles, saved(cells), back(WHOLE), 1)).toBeNull();
  });

  it("refuses more coming home than ever went out", () => {
    const cells = cellTotals([stored({ units: -10 })]);
    expect(cellFault(cans, shelf, saved(cells), back(), 14)).toBe("moreThanWentOut");
    expect(cellFault(cans, shelf, saved(cells), back(), 10)).toBeNull();
  });

  it("counts a spill against the night as well", () => {
    const cells = cellTotals([stored({ units: -10 }), stored({ kind: "RETURN", units: 8 })]);
    expect(cellFault(cans, shelf, saved(cells), spill(), 4)).toBe("moreThanWentOut");
    expect(cellFault(cans, shelf, saved(cells), spill(), 2)).toBeNull();
  });

  it("lets a figure be lowered without asking the shelf for anything", () => {
    // Correcting 120 down to 100 puts twenty cans back. The cellar is never
    // short of room, so this can only ever be allowed.
    const cells = cellTotals([stored({ units: -120 })]);
    expect(cellFault(cans, { sealed: 0, open: {} }, saved(cells), out(), 100)).toBeNull();
  });

  it("refuses lowering a return below what the shelf could give back", () => {
    // Undoing a homecoming takes the cans off the shelf again, and they have to
    // still be there.
    const cells = cellTotals([stored({ units: -50 }), stored({ kind: "RETURN", units: 20 })]);
    expect(cellFault(cans, { sealed: 5, open: {} }, saved(cells), back(), 0)).toBe("notThatManySealed");
    expect(cellFault(cans, { sealed: 40, open: {} }, saved(cells), back(), 0)).toBeNull();
  });

  it("has nothing to say about a cell set to what it already is", () => {
    const cells = cellTotals([stored({ units: -120 })]);
    expect(cellFault(cans, { sealed: 0, open: {} }, saved(cells), out(), 120)).toBeNull();
  });
});

describe("cellFault, before anything is saved", () => {
  // Reported from the bar: eight beers out, nothing saved yet, and one of them
  // dropped, refused, on the grounds that nothing had gone out. It had: it was
  // on the screen. The rule was reading the log where it should have been
  // reading the sheet.
  //
  // Which half reads which is the whole of it. The night's arithmetic is about
  // what the sheet says; only the cellar's is about what the log holds, because
  // the shelf has moved for those rows and for no others.
  const shelf = { sealed: 200, open: {} };
  const nothingSaved = new Map<string, number>();

  it("counts a checkout that is only typed in", () => {
    const typed = cellTotals([stored({ units: -8 })]);
    const state = { sheet: typed, booked: nothingSaved };
    expect(cellFault(cans, shelf, state, spill(), 1)).toBeNull();
    expect(cellFault(cans, shelf, state, back(), 8)).toBeNull();
    // And still refuses what the night cannot have done, saved or not.
    expect(cellFault(cans, shelf, state, back(), 9)).toBe("moreThanWentOut");
  });

  it("lets a row be cleared column by column", () => {
    // Taking a product off the sheet zeroes every one of its cells. Each zero
    // used to be judged with its neighbours still at their old figures, so
    // clearing Ut while Spill still read 1 was "more than went out". The Ut
    // cell was held back from the save and only the spill was cleared.
    const cleared = new Map<string, number>();
    const booked = cellTotals([
      stored({ units: -8 }),
      stored({ kind: "WASTE", spilledQty: 1 }),
    ]);
    const state = { sheet: cleared, booked };
    expect(cellFault(cans, shelf, state, out(), 0)).toBeNull();
    expect(cellFault(cans, shelf, state, spill(), 0)).toBeNull();
  });

  it("still measures the cellar against the log, not against the sheet", () => {
    // The shelf has not moved for a figure nobody has saved. Counting an
    // unsaved checkout against it as well would spend the same bottles twice.
    const typed = cellTotals([stored({ units: -150 })]);
    const state = { sheet: typed, booked: new Map<string, number>() };
    expect(cellFault(cans, { sealed: 200, open: {} }, state, out(), 150)).toBeNull();
    expect(cellFault(cans, { sealed: 200, open: {} }, state, out(), 201)).toBe(
      "notThatManySealed",
    );
  });
});

describe("cellKey", () => {
  it("tells the three columns of one product apart", () => {
    expect(new Set([cellKey(out()), cellKey(back()), cellKey(spill())]).size).toBe(3);
  });

  it("tells the rungs of one column apart", () => {
    expect(cellKey(out(40))).not.toBe(cellKey(out(20)));
  });
});

describe("cellFault, against what the night found", () => {
  // The trap this closes: two bottles go out sealed and come home at 60 %, and
  // the 60 % rung then lights up offering the very bottles just carried in. The
  // ladder used to mutate as the In column was filled, which is confusing, and
  // pointless, because out-and-back-and-out again is the same 1 400 ml as out
  // and never returned.
  const cellsOf = (...rows: CellRow[]) => cellTotals(rows);

  it("refuses taking out what this event has just brought back", () => {
    const shelf = { sealed: 3, open: { 60: 2 } };
    const cells = cellsOf(
      stored({ units: -2 }),
      stored({ kind: "RETURN", level: 60, open: { 60: 2 } }),
    );
    expect(cellFault(vodka, shelf, saved(cells), out(60), 2)).toBe("notThatManyOpen");
  });

  it("still allows taking out what the cellar had before", () => {
    // Three at 60 % to begin with, two more brought back: the three are still
    // takeable and the two are not.
    const shelf = { sealed: 0, open: { 60: 5 } };
    const cells = cellsOf(stored({ kind: "RETURN", level: 60, open: { 60: 2 } }));
    expect(cellFault(vodka, shelf, saved(cells), out(60), 3)).toBeNull();
    expect(cellFault(vodka, shelf, saved(cells), out(60), 4)).toBe("notThatManyOpen");
  });

  it("counts what it has already taken from a rung as still its own", () => {
    // Three there at the start, one already out: taking a second is fine, a
    // fourth is not.
    const shelf = { sealed: 0, open: { 40: 2 } };
    const cells = cellsOf(stored({ level: 40, open: { 40: -1 } }));
    expect(cellFault(vodka, shelf, saved(cells), out(40), 3)).toBeNull();
    expect(cellFault(vodka, shelf, saved(cells), out(40), 4)).toBe("notThatManyOpen");
  });

  it("does not let a night's own returns lock its sealed bottles away", () => {
    // The open-first rule is about the dregs the cellar was already holding.
    // Bottles this night carried back are not somebody else's problem to take.
    const shelf = { sealed: 4, open: { 60: 2 } };
    const cells = cellsOf(
      stored({ units: -2 }),
      stored({ kind: "RETURN", level: 60, open: { 60: 2 } }),
    );
    expect(cellFault(vodka, shelf, saved(cells), out(WHOLE), 3)).toBeNull();
  });

  it("still keeps the rule for dregs that were there all along", () => {
    const shelf = { sealed: 5, open: { 20: 1 } };
    expect(cellFault(vodka, shelf, saved(new Map()), out(WHOLE), 1)).toBe("openBottlesFirst");
  });

  it("lets a sealed bottle go along with the last of the open ones", () => {
    // The rule is about what stays behind. The cellar's one 20 % bottle is
    // already on this night's Ut ladder, so the shelf reads empty at that rung
    // and nothing is being left to go stale.
    const shelf = { sealed: 5, open: {} };
    const cells = cellsOf(stored({ level: 20, open: { 20: -1 } }));
    expect(cellFault(vodka, shelf, saved(cells), out(WHOLE), 2)).toBeNull();
  });

  it("counts the open ones typed and not yet saved", () => {
    // The commonest way round: both rungs are typed into the sheet and neither
    // has been sent, so the shelf still shows them and only the night's own Ut
    // column knows the dregs are coming too.
    const shelf = { sealed: 5, open: { 60: 1, 20: 1 } };
    const typing: SheetState = {
      booked: new Map<string, number>(),
      sheet: cellsOf(
        stored({ level: 60, open: { 60: -1 } }),
        stored({ level: 20, open: { 20: -1 } }),
      ),
    };
    expect(cellFault(vodka, shelf, typing, out(WHOLE), 2)).toBeNull();
  });

  it("still refuses a sealed one while a rung is left behind", () => {
    // Taking the 60 % bottle and leaving the 20 % one is exactly what the rule
    // exists to stop.
    const shelf = { sealed: 5, open: { 60: 1, 20: 1 } };
    const typing: SheetState = {
      booked: new Map<string, number>(),
      sheet: cellsOf(stored({ level: 60, open: { 60: -1 } })),
    };
    expect(cellFault(vodka, shelf, typing, out(WHOLE), 2)).toBe("openBottlesFirst");
  });

  it("lets a return be undone while the bottles are still on the shelf", () => {
    const shelf = { sealed: 0, open: { 60: 2 } };
    const cells = cellsOf(
      stored({ units: -2 }),
      stored({ kind: "RETURN", level: 60, open: { 60: 2 } }),
    );
    expect(cellFault(vodka, shelf, saved(cells), back(60), 0)).toBeNull();
    expect(cellFault(vodka, shelf, saved(cells), back(60), 1)).toBeNull();
  });
});

describe("cellFault, bringing back more than went out", () => {
  // Reported from the sheet: two bottles out, both home at 80 %, and one more
  // typed in at 60 %. Three bottles cannot come home from a night that took
  // two, and the rule has to say so, as a fault somebody can retype, never by
  // closing the box they are typing in.
  const shelf = { sealed: 3, open: { 80: 2 } };
  const night = cellTotals([
    stored({ units: -2 }),
    stored({ kind: "RETURN", level: 80, open: { 80: 2 } }),
  ]);

  it("refuses the one too many", () => {
    // Out 2 × 700 = 1400 ml. Home 2 × 560 = 1120, and 420 more would be 1540.
    expect(cellFault(vodka, shelf, saved(night), back(60), 1)).toBe("moreThanWentOut");
  });

  it("refuses a third bottle even where the millilitres would allow it", () => {
    // 280 ml is unaccounted for, which is a 40 % bottle's worth. But both
    // bottles are already home. The missing 280 ml was drunk; it is not a third
    // bottle waiting to be carried back.
    expect(cellFault(vodka, shelf, saved(night), back(40), 1)).toBe("moreBottlesThanWentOut");
  });

  it("allows the second bottle home when only one has come back", () => {
    const one = cellTotals([
      stored({ units: -2 }),
      stored({ kind: "RETURN", level: 80, open: { 80: 1 } }),
    ]);
    expect(cellFault(vodka, shelf, saved(one), back(40), 1)).toBeNull();
  });

  it("lets an overshoot already in the log be cleared", () => {
    // The repair path. A product whose figures do not add up must not have
    // every one of its cells refused, or the cell you clear to fix it is
    // refused too. The bottle that came back at 60 % is on the shelf, which is
    // what makes clearing it possible: undoing a homecoming takes it off again.
    const wrong = cellTotals([
      stored({ units: -2 }),
      stored({ kind: "RETURN", level: 80, open: { 80: 2 } }),
      stored({ kind: "RETURN", level: 60, open: { 60: 1 } }),
    ]);
    const held = { sealed: 3, open: { 80: 2, 60: 1 } };
    expect(cellFault(vodka, held, saved(wrong), back(60), 0)).toBeNull();
    expect(cellFault(vodka, held, saved(wrong), back(80), 1)).toBeNull();
  });
});

describe("cellFault, counted in bottles", () => {
  // Reported from the sheet: two bottles out and three back. The millilitre
  // check passes it (three at 20 % is 420 ml against the 1 400 that left) and
  // it is still impossible. Bottles are countable things and the count holds on
  // its own.
  const shelf = { sealed: 5, open: {} };
  const twoOut = cellTotals([stored({ units: -2 })]);

  it("refuses a third bottle home from a night that took two", () => {
    const twoBack = cellTotals([
      stored({ units: -2 }),
      stored({ kind: "RETURN", level: 20, open: { 20: 2 } }),
    ]);
    expect(cellFault(vodka, shelf, saved(twoBack), back(40), 1)).toBe("moreBottlesThanWentOut");
  });

  it("allows the two that did go out, at any level", () => {
    expect(cellFault(vodka, shelf, saved(twoOut), back(20), 2)).toBeNull();
    expect(cellFault(vodka, shelf, saved(twoOut), back(20), 3)).toBe("moreBottlesThanWentOut");
  });

  it("counts a dropped bottle as one that will not be coming home", () => {
    const oneBack = cellTotals([
      stored({ units: -2 }),
      stored({ kind: "RETURN", level: 40, open: { 40: 1 } }),
    ]);
    expect(cellFault(vodka, shelf, saved(oneBack), spill(40), 1)).toBeNull();
    expect(cellFault(vodka, shelf, saved(oneBack), spill(40), 2)).toBe("moreBottlesThanWentOut");
  });

  it("still catches an overshoot in millilitres before counting vessels", () => {
    // Two out, two home, but home fuller than they left, which is a different
    // impossibility and deserves its own sentence.
    const twoOutOpen = cellTotals([stored({ level: 20, open: { 20: -2 } })]);
    expect(cellFault(vodka, { sealed: 0, open: { 20: 2 } }, saved(twoOutOpen), back(80), 2)).toBe(
      "moreThanWentOut",
    );
  });

  it("leaves cans alone, where the two questions are one", () => {
    const out10 = cellTotals([stored({ units: -10 })]);
    expect(cellFault(cans, { sealed: 50, open: {} }, saved(out10), back(), 10)).toBeNull();
    expect(cellFault(cans, { sealed: 50, open: {} }, saved(out10), back(), 11)).toBe("moreThanWentOut");
  });
});
