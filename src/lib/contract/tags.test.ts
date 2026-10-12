import { describe, expect, it } from "vitest";
import { MAX_TAG_LENGTH, MAX_TAGS, normaliseTag, normaliseTags } from "./tags";

describe("normaliseTag", () => {
  it("lower-cases and trims, so three spellings become one word", () => {
    expect(normaliseTag(" Ljud ")).toBe("ljud");
    expect(normaliseTag("LJUD")).toBe("ljud");
    expect(normaliseTag("ljud")).toBe("ljud");
  });

  it("collapses inner whitespace rather than removing it", () => {
    // A tag is a label somebody reads, so "gamla iDét" stays two words.
    expect(normaliseTag("gamla   iDét")).toBe("gamla idét");
  });

  it("lower-cases Swedish letters", () => {
    expect(normaliseTag("TÄLT")).toBe("tält");
    expect(normaliseTag("Ölbord")).toBe("ölbord");
  });

  it("truncates a tag somebody pasted a sentence into", () => {
    expect(normaliseTag("x".repeat(200))).toHaveLength(MAX_TAG_LENGTH);
  });
});

describe("normaliseTags", () => {
  it("drops blanks and duplicates that differ only in case", () => {
    expect(normaliseTags(["Ljud", "", "  ", "ljud", "TÄLT"])).toEqual(["ljud", "tält"]);
  });

  it("keeps the order they were typed in", () => {
    // Not sorted: the first one is usually the one that mattered.
    expect(normaliseTags(["tält", "ljud", "nollning"])).toEqual(["tält", "ljud", "nollning"]);
  });

  it("caps the list", () => {
    const many = Array.from({ length: MAX_TAGS + 10 }, (_, i) => `tag${i}`);
    expect(normaliseTags(many)).toHaveLength(MAX_TAGS);
  });

  it("counts the cap in de-duplicated tags, not in what was submitted", () => {
    const repeated = Array.from({ length: MAX_TAGS + 10 }, () => "ljud");
    expect(normaliseTags(repeated)).toEqual(["ljud"]);
  });
});
