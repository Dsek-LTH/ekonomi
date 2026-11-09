import { describe, expect, it } from "vitest";

import { isWholeDate, listQueryToSearch, parseListQuery } from "./list-query";

describe("date filters survive the round trip", () => {
  // Regression: the controls wrote every keystroke to the URL while the parser dropped partial
  // dates, so the field blanked itself as you typed.
  const parse = (sp: Record<string, string>) => parseListQuery(sp);

  it("keeps a whole date", () => {
    expect(parse({ from: "2026-05-01", to: "2026-05-31" })).toMatchObject({
      from: "2026-05-01",
      to: "2026-05-31",
    });
  });

  it.each(["2", "20", "2026", "2026-0", "2026-05", "2026-05-0", "yesterday", "2026-13-40x"])(
    "drops %o, which is not a filter yet",
    (partial) => {
      expect(parse({ from: partial, to: partial })).toMatchObject({ from: "", to: "" });
    },
  );

  it("agrees with isWholeDate about every one of those", () => {
    for (const v of ["2026-05-01", "2", "2026", "2026-05", "", "nonsense"]) {
      expect(isWholeDate(v)).toBe(parse({ from: v }).from === v && v !== "");
    }
  });

  it("leaves a dropped date out of the address rather than writing it empty", () => {
    const search = listQueryToSearch(parse({ from: "2026-0", q: "kaffe" }));
    expect(search).not.toContain("from");
    expect(search).toContain("q=kaffe");
  });
});
