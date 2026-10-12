import { describe, expect, it } from "vitest";
import { cleanTags, hasTag, tagsInUse } from "./tags";

describe("cleanTags", () => {
  it("trims, drops blanks and sorts", () => {
    expect(cleanTags([" vodka ", "", "  ", "cognac"])).toEqual(["cognac", "vodka"]);
  });

  it("keeps one of a tag spelled two ways, the first spelling", () => {
    expect(cleanTags(["Whisky", "whisky", "WHISKY"])).toEqual(["Whisky"]);
  });

  it("collapses the space inside a tag, so two are not made of one", () => {
    expect(cleanTags(["single  malt", "single malt"])).toEqual(["single malt"]);
  });

  it("sorts the Swedish way, so å ä ö come last rather than beside a", () => {
    expect(cleanTags(["öl", "ale", "ätt"])).toEqual(["ale", "ätt", "öl"]);
  });
});

describe("hasTag", () => {
  it("answers about the tag, not about its spelling", () => {
    expect(hasTag(["Whisky"], "whisky ")).toBe(true);
    expect(hasTag(["Whisky"], "whiskey")).toBe(false);
  });
});

describe("tagsInUse", () => {
  it("is every tag the products carry, once each", () => {
    expect(
      tagsInUse([
        { tags: ["whisky", "rök"] },
        { tags: ["Whisky"] },
        { tags: [] },
      ]),
    ).toEqual(["rök", "whisky"]);
  });
});
