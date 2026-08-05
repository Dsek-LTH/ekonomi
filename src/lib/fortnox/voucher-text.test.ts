import { describe, expect, it } from "vitest";
import { VOUCHER_DESCRIPTION_MAX, voucherText } from "./voucher-text";

describe("voucherText", () => {
  it("puts the reference in parentheses at the end", () => {
    expect(voucherText("PU Anna Andersson lunch", "DEK26-0043")).toBe(
      "PU Anna Andersson lunch (DEK26-0043)",
    );
  });

  it("leaves the text alone otherwise", () => {
    expect(voucherText("  PU Anna Andersson  ", "DEK26-0001")).toBe(
      "PU Anna Andersson (DEK26-0001)",
    );
  });

  it("sends the text as it stands when there is no reference yet", () => {
    expect(voucherText("PU Anna Andersson", null)).toBe("PU Anna Andersson");
  });

  // Fortnox cuts Description at 200 characters. Cutting from the end would take
  // the reference with it and leave a voucher nothing traces back to, so the
  // text is what gets shortened.
  it("keeps the reference when the text is too long to fit", () => {
    const long = "x".repeat(300);
    const out = voucherText(long, "DEK26-0043");
    expect(out.length).toBeLessThanOrEqual(VOUCHER_DESCRIPTION_MAX);
    expect(out.endsWith(" (DEK26-0043)")).toBe(true);
  });

  it("does not leave a dangling space where the text was cut", () => {
    const out = voucherText(`${"x".repeat(185)} tail`, "DEK26-0043");
    expect(out).not.toContain("  ");
    expect(out.endsWith(" (DEK26-0043)")).toBe(true);
  });

  it("is just the reference when there is no text to carry it", () => {
    expect(voucherText("", "DEK26-0043")).toBe("(DEK26-0043)");
  });
});
