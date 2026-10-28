import { describe, expect, it } from "vitest";

import { fiscalYearApplies, fiscalYearLabel, inFiscalYear } from "./fiscal-year";

const y2025 = { id: 1, fromDate: "2025-01-01", toDate: "2025-12-31" };

describe("fiscalYearApplies", () => {
  it("applies to every list with a date, the Inkorg included", () => {
    for (const path of ["/dashboard", "/expenses", "/expenses/review", "/bank", "/invoices", "/invoices/inbox", "/income", "/budget", "/ledger", "/closing"]) {
      expect(fiscalYearApplies(path), path).toBe(true);
    }
  });

  it("does not apply to the bokslut template, which is the same every year", () => {
    expect(fiscalYearApplies("/closing/template")).toBe(false);
  });

  it("does not apply to pages outside the books", () => {
    expect(fiscalYearApplies("/stock")).toBe(false);
    expect(fiscalYearApplies("/faq")).toBe(false);
  });
});

describe("inFiscalYear", () => {
  it("holds both ends of the year", () => {
    expect(inFiscalYear(y2025, "2025-01-01")).toBe(true);
    expect(inFiscalYear(y2025, "2025-12-31T23:00:00.000Z")).toBe(true);
  });

  it("holds nothing outside it, or undated", () => {
    expect(inFiscalYear(y2025, "2026-01-01")).toBe(false);
    expect(inFiscalYear(y2025, null)).toBe(false);
  });
});

describe("fiscalYearLabel", () => {
  it("is the year, or both halves of a broken one", () => {
    expect(fiscalYearLabel(y2025)).toBe("2025");
    expect(fiscalYearLabel({ id: 2, fromDate: "2025-07-01", toDate: "2026-06-30" })).toBe("2025/26");
  });
});
