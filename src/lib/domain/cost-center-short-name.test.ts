import { describe, expect, it } from "vitest";

import { nameUnderUnit, suggestShortName } from "./cost-center-short-name";

describe("suggestShortName", () => {
  it("takes the unit's name and the separator off the front", () => {
    expect(suggestShortName("Aktivitetsutskottet - Funktionärer", "Aktivitetsutskottet")).toBe("Funktionärer");
  });

  it("takes a colon, a slash or a dash from Fortnox as the separator", () => {
    expect(suggestShortName("Sexmästeriet: Sittningar", "Sexmästeriet")).toBe("Sittningar");
    expect(suggestShortName("Sexmästeriet/Sittningar", "Sexmästeriet")).toBe("Sittningar");
    expect(suggestShortName("Sexmästeriet \u2013 Sittningar", "Sexmästeriet")).toBe("Sittningar");
  });

  it("ignores case and spacing", () => {
    expect(suggestShortName("  sexmästeriet  -  Sittningar ", " Sexmästeriet ")).toBe("Sittningar");
  });

  it("wants a separator, not only the unit's letters", () => {
    expect(suggestShortName("Sexmästeriets fond", "Sexmästeriet")).toBeNull();
  });

  it("suggests nothing for a name that does not start with the unit", () => {
    expect(suggestShortName("Funktionärer", "Aktivitetsutskottet")).toBeNull();
    expect(suggestShortName("AKT - Funktionärer", "Aktivitetsutskottet")).toBeNull();
  });

  it("suggests nothing when only the unit's name is left", () => {
    expect(suggestShortName("Sexmästeriet", "Sexmästeriet")).toBeNull();
    expect(suggestShortName("Sexmästeriet - ", "Sexmästeriet")).toBeNull();
  });

  it("suggests nothing without a result unit", () => {
    expect(suggestShortName("Aktivitetsutskottet - Funktionärer", null)).toBeNull();
    expect(suggestShortName("Aktivitetsutskottet - Funktionärer", "  ")).toBeNull();
  });

  it("keeps a dash further on in the name", () => {
    expect(suggestShortName("Sexmästeriet - Sittning - vår", "Sexmästeriet")).toBe("Sittning - vår");
  });
});

describe("nameUnderUnit", () => {
  it("is the short name when there is one", () => {
    expect(nameUnderUnit({ name: "Aktivitetsutskottet - Funktionärer", shortName: "Funktionärer" })).toBe("Funktionärer");
  });

  it("is the full name when there is none, or only spaces", () => {
    expect(nameUnderUnit({ name: "Funktionärer", shortName: null })).toBe("Funktionärer");
    expect(nameUnderUnit({ name: "Funktionärer", shortName: "  " })).toBe("Funktionärer");
  });
});
