import { describe, expect, it } from "vitest";
import { accountRangeFor, orient, sectionsFor, type ReportKind } from "./bas";

describe("orient", () => {
  it("shows a debit-oriented section as it stands", () => {
    expect(orient(5000, "debit")).toBe(5000);
    expect(orient(-5000, "debit")).toBe(-5000);
  });

  it("flips a credit-oriented section, so income reads positive", () => {
    // The ledger stores income as a credit (negative net); Fortnox prints it
    // positive, and the reports have to agree with Fortnox.
    expect(orient(-5000, "credit")).toBe(5000);
    expect(orient(5000, "credit")).toBe(-5000);
  });
});

describe.each(["RESULT", "BALANCE"] as ReportKind[])("%s sections", (kind) => {
  const sections = sectionsFor(kind);

  it("covers its whole account range with no gap and no overlap", () => {
    // A gap would drop an account out of the report without anyone noticing:
    // the section totals would still add up, just not to the right figure.
    const range = accountRangeFor(kind);
    const ordered = [...sections].sort((a, b) => a.from - b.from);

    expect(ordered[0].from).toBe(range.from);
    expect(ordered[ordered.length - 1].to).toBe(range.to);

    for (let i = 1; i < ordered.length; i++) {
      expect(ordered[i].from).toBe(ordered[i - 1].to + 1);
    }
  });

  it("gives every section a non-empty span", () => {
    for (const s of sections) {
      expect(s.to).toBeGreaterThanOrEqual(s.from);
    }
  });

  it("places every account in its range in exactly one section", () => {
    const range = accountRangeFor(kind);
    for (const account of [range.from, range.to, 1930, 2890, 3010, 5010, 7690]) {
      if (account < range.from || account > range.to) continue;
      const matches = sections.filter((s) => account >= s.from && account <= s.to);
      expect(matches).toHaveLength(1);
    }
  });
});

describe("the two reports together", () => {
  it("split the chart between them without meeting", () => {
    // 1000–2999 is the balance sheet, 3000–8999 the result. A 1930 row has no
    // place in a result report, and vice versa.
    const balance = accountRangeFor("BALANCE");
    const result = accountRangeFor("RESULT");
    expect(balance.to).toBeLessThan(result.from);
  });
});

