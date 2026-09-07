import { describe, expect, it } from "vitest";
import { rentalTitle, signatoryTitle } from "./signatory";

describe("signatoryTitle", () => {
  it("names the post a firmatecknare signs under", () => {
    expect(signatoryTitle(["SKATTMASTARE"])).toBe("Skattmästare");
    expect(signatoryTitle(["ORDFORANDE"])).toBe("Ordförande");
  });

  it("prefers the senior post when somebody holds several", () => {
    // A skattmästare acting as ordförande signs as ordförande, which is what a
    // counterparty would expect to see.
    expect(signatoryTitle(["SKATTMASTARE", "ORDFORANDE"])).toBe("Ordförande");
  });

  it("prints nothing rather than inventing a title", () => {
    // FIRMATECKNARE is editable, so the section can grant it to a post this
    // list has never heard of. An empty line under the name beats a made-up one.
    expect(signatoryTitle(["STOCKARE"])).toBeNull();
    expect(signatoryTitle([])).toBeNull();
  });

  it("is Swedish whatever the reader's interface is set to", () => {
    // The document binds two parties. It cannot rename its signatory because
    // somebody switched the app to English.
    expect(signatoryTitle(["ORDFORANDE"])).toBe("Ordförande");
  });
});

describe("rentalTitle", () => {
  it("says what it is and who it is with", () => {
    expect(rentalTitle("W-sektionen inom TLTH")).toBe("Uthyrning till W-sektionen inom TLTH");
  });

  it("trims what was typed", () => {
    expect(rentalTitle("  F-sektionen  ")).toBe("Uthyrning till F-sektionen");
  });

  it("still gives a title when the renter is blank", () => {
    // The archive list needs something to draw. A row titled "" is a row
    // nobody can find again.
    expect(rentalTitle("")).toBe("Uthyrning");
    expect(rentalTitle("   ")).toBe("Uthyrning");
  });
});
