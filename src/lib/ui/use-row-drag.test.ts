import { describe, expect, it } from "vitest";
import { placeAmong } from "./use-row-drag";

describe("placeAmong", () => {
  const ids = ["a", "b", "c", "d"];

  it("puts the row before or after the one it is over", () => {
    expect(placeAmong(ids, "a", "c", false)).toEqual(["b", "a", "c", "d"]);
    expect(placeAmong(ids, "a", "c", true)).toEqual(["b", "c", "a", "d"]);
    expect(placeAmong(ids, "d", "a", false)).toEqual(["d", "a", "b", "c"]);
  });

  it("puts it last when it is over nothing, or over a row not in the list", () => {
    expect(placeAmong(ids, "a", null, false)).toEqual(["b", "c", "d", "a"]);
    expect(placeAmong(ids, "a", "x", false)).toEqual(["b", "c", "d", "a"]);
  });

  it("takes in a row from another list", () => {
    expect(placeAmong(["b", "c"], "a", "c", false)).toEqual(["b", "a", "c"]);
  });
});
