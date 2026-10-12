import { describe, expect, it } from "vitest";
import { parseSystembolagetId, systembolagetSearchUrl } from "./systembolaget";

describe("parseSystembolagetId", () => {
  it("takes the number straight", () => {
    expect(parseSystembolagetId("141215")).toBe("141215");
    expect(parseSystembolagetId("  141215  ")).toBe("141215");
  });

  it("reads it off a pasted product URL", () => {
    expect(
      parseSystembolagetId("https://www.systembolaget.se/produkt/ol/norrlands-guld-141215/"),
    ).toBe("141215");
    // Without the trailing slash, and without the scheme.
    expect(parseSystembolagetId("www.systembolaget.se/produkt/ol/norrlands-guld-141215")).toBe(
      "141215",
    );
  });

  it("ignores a query string or fragment the browser added", () => {
    expect(
      parseSystembolagetId(
        "https://www.systembolaget.se/produkt/ol/norrlands-guld-141215/?utm_source=99",
      ),
    ).toBe("141215");
    expect(parseSystembolagetId("https://www.systembolaget.se/produkt/ol/x-141215/#recension")).toBe(
      "141215",
    );
  });

  it("is not fooled by digits in the name", () => {
    // The article number is the last run, never the first.
    expect(parseSystembolagetId("brooklyn-1-2-3-141215")).toBe("141215");
    expect(parseSystembolagetId("https://www.systembolaget.se/produkt/ol/carlsberg-33cl-108512/"))
      .toBe("108512");
  });

  it("says nothing rather than guessing", () => {
    expect(parseSystembolagetId("")).toBeNull();
    expect(parseSystembolagetId("   ")).toBeNull();
    expect(parseSystembolagetId("norrlands guld")).toBeNull();
    // Too short to be an article number, so not one.
    expect(parseSystembolagetId("ol-12")).toBeNull();
    // A barcode pasted into the wrong field.
    expect(parseSystembolagetId("7312040017072")).toBeNull();
  });
});

describe("systembolagetSearchUrl", () => {
  it("points at the article", () => {
    expect(systembolagetSearchUrl("141215")).toBe(
      "https://www.systembolaget.se/sok?textQuery=141215",
    );
  });

  it("refuses to build one from nonsense", () => {
    expect(systembolagetSearchUrl("")).toBeNull();
    expect(systembolagetSearchUrl("abc")).toBeNull();
  });
});
