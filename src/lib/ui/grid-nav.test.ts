import { describe, expect, it } from "vitest";
import { atTextEdge, findCell, nextCell, stepCell, type Grid } from "./grid-nav";

// Three columns, four rows, with holes where a cell is locked or absent.
const grid: Grid = [
  ["a1", "b1", "c1"],
  ["a2", null, "c2"],
  [null, null, null],
  ["a4", "b4", "c4"],
];
const all = () => true;
const not = (...blocked: string[]) => (c: string) => !blocked.includes(c);

describe("findCell", () => {
  it("gives a cell's place", () => {
    expect(findCell(grid, "b4")).toEqual([3, 1]);
  });

  it("has nothing to say about a cell that is not there", () => {
    expect(findCell(grid, "zz")).toBeNull();
  });
});

describe("nextCell", () => {
  it("reads across before it reads down", () => {
    expect(nextCell(grid, "a1", 1, all)).toBe("b1");
    expect(nextCell(grid, "b1", 1, all)).toBe("c1");
  });

  it("continues on the next row at the end of one", () => {
    expect(nextCell(grid, "c1", 1, all)).toBe("a2");
  });

  it("skips holes rather than stopping at them", () => {
    // b2 is locked and the whole of row 3 is absent.
    expect(nextCell(grid, "a2", 1, all)).toBe("c2");
    expect(nextCell(grid, "c2", 1, all)).toBe("a4");
  });

  it("skips a cell the caller says cannot take focus", () => {
    // A column the phone is not showing.
    expect(nextCell(grid, "a1", 1, not("b1"))).toBe("c1");
  });

  it("goes backwards the same way", () => {
    expect(nextCell(grid, "a2", -1, all)).toBe("c1");
    expect(nextCell(grid, "a4", -1, all)).toBe("c2");
  });

  it("has nothing past the end, so the key can fall through", () => {
    // Which is what stops the grid becoming a keyboard trap.
    expect(nextCell(grid, "c4", 1, all)).toBeNull();
    expect(nextCell(grid, "a1", -1, all)).toBeNull();
  });

  it("has nothing to say about a cell that is not in the grid", () => {
    expect(nextCell(grid, "zz", 1, all)).toBeNull();
  });
});

describe("stepCell", () => {
  it("moves down a column", () => {
    expect(stepCell(grid, "a1", 1, 0, all)).toBe("a2");
  });

  it("passes over holes in a column rather than stopping", () => {
    // A hole in the middle of a column is not the end of it.
    expect(stepCell(grid, "b1", 1, 0, all)).toBe("b4");
  });

  it("moves across a row", () => {
    expect(stepCell(grid, "a2", 0, 1, all)).toBe("c2");
  });

  it("stops at the edge instead of wrapping", () => {
    // The difference between a direction and a sequence: `nextCell` would have
    // carried on to the next row here.
    expect(stepCell(grid, "c1", 0, 1, all)).toBeNull();
    expect(stepCell(grid, "a1", -1, 0, all)).toBeNull();
    expect(stepCell(grid, "c4", 1, 0, all)).toBeNull();
  });

  it("respects what the caller says can take focus", () => {
    expect(stepCell(grid, "a1", 1, 0, not("a2"))).toBe("a4");
  });
});

describe("atTextEdge", () => {
  const field = (value: string, start: number, end = start) => ({
    value,
    selectionStart: start,
    selectionEnd: end,
  });

  it("is at the start only with the caret before the first character", () => {
    expect(atTextEdge(field("240", 0), -1)).toBe(true);
    expect(atTextEdge(field("240", 1), -1)).toBe(false);
  });

  it("is at the end only with the caret after the last", () => {
    expect(atTextEdge(field("240", 3), 1)).toBe(true);
    expect(atTextEdge(field("240", 2), 1)).toBe(false);
  });

  it("is never at an edge while something is selected", () => {
    // The arrow collapses the selection; it does not leave the cell.
    expect(atTextEdge(field("240", 0, 3), -1)).toBe(false);
    expect(atTextEdge(field("240", 0, 3), 1)).toBe(false);
  });

  it("treats an empty box as both edges at once", () => {
    expect(atTextEdge(field("", 0), -1)).toBe(true);
    expect(atTextEdge(field("", 0), 1)).toBe(true);
  });

  it("lets the arrow move where there is no caret to report", () => {
    expect(atTextEdge({ value: "", selectionStart: null, selectionEnd: null }, 1)).toBe(true);
  });
});
