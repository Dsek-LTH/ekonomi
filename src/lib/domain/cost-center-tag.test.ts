import { describe, expect, it } from "vitest";

import { retagRowText, withCostCenterTag, withoutCostCenterTag } from "./cost-center-tag";

const local = new Set(["SEX-ALKO", "MED-ALKO"]);
const isLocal = (code: string) => local.has(code);

describe("withCostCenterTag", () => {
  it("puts the code at the end of the text", () => {
    expect(withCostCenterTag("Öl till pub", "SEX-ALKO")).toBe("Öl till pub (SEX-ALKO)");
  });

  it("is the tag alone on an empty row", () => {
    expect(withCostCenterTag("", "SEX-ALKO")).toBe("(SEX-ALKO)");
  });

  it("does not add it twice", () => {
    expect(withCostCenterTag("Öl (SEX-ALKO) till pub", "SEX-ALKO")).toBe("Öl (SEX-ALKO) till pub");
  });

  it("shortens the text, never the tag, to fit Fortnox's limit", () => {
    const out = withCostCenterTag("x".repeat(120), "SEX-ALKO");
    expect(out.length).toBeLessThanOrEqual(100);
    expect(out.endsWith(" (SEX-ALKO)")).toBe(true);
  });
});

describe("withoutCostCenterTag", () => {
  it("takes the tag off and tidies the spacing", () => {
    expect(withoutCostCenterTag("Öl till pub (SEX-ALKO)", "SEX-ALKO")).toBe("Öl till pub");
  });
});

describe("retagRowText", () => {
  it("tags a row when a local cost centre is picked", () => {
    expect(retagRowText("Öl", "", "SEX-ALKO", isLocal)).toBe("Öl (SEX-ALKO)");
  });

  it("swaps the tag when one local cost centre replaces another", () => {
    expect(retagRowText("Öl (SEX-ALKO)", "SEX-ALKO", "MED-ALKO", isLocal)).toBe("Öl (MED-ALKO)");
  });

  it("takes the tag off when a Fortnox cost centre replaces a local one", () => {
    expect(retagRowText("Öl (SEX-ALKO)", "SEX-ALKO", "SEX03", isLocal)).toBe("Öl");
  });

  it("leaves a Fortnox cost centre's row text alone", () => {
    expect(retagRowText("Kolsyra", "", "SEX01", isLocal)).toBe("Kolsyra");
  });
});
