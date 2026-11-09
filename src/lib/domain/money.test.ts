import { describe, expect, it } from "vitest";
import {
  commaForm,
  groupForm,
  isAmountInput,
  isSumInput,
  settleAmount,
  oreToSEK,
  parseOre,
  parseSEK,
  sekToOre,
} from "./money";

describe("oreToSEK", () => {
  it("divides by 100", () => {
    expect(oreToSEK(12345)).toBe(123.45);
    expect(oreToSEK(100)).toBe(1);
    expect(oreToSEK(1)).toBe(0.01);
  });

  it("keeps the sign of a return", () => {
    expect(oreToSEK(-25000)).toBe(-250);
  });

  it("treats a missing amount as zero rather than NaN", () => {
    // Nullable columns reach this straight from Prisma; NaN would propagate into a sum.
    expect(oreToSEK(null)).toBe(0);
    expect(oreToSEK(undefined)).toBe(0);
  });
});

describe("sekToOre", () => {
  it("multiplies by 100 and rounds to an integer", () => {
    expect(sekToOre(123.45)).toBe(12345);
    expect(sekToOre(-250)).toBe(-25000);
    expect(sekToOre(null)).toBe(0);
  });

  it("survives the float multiplications that öre storage exists to avoid", () => {
    // 19.99 * 100 is 1998.9999999999998: without rounding a one-öre discrepancy enters the ledger.
    expect(sekToOre(19.99)).toBe(1999);
    expect(sekToOre(0.29)).toBe(29);
  });

  it("rounds a half-öre down, because the float is already below the half", () => {
    // 1.005 * 100 is 100.49999999999999, so this rounds to 100. Pinned, not fixed: SEK has at most two decimals.
    expect(sekToOre(1.005)).toBe(100);
  });
});

describe("parseSEK", () => {
  it("reads the formats a Swedish keyboard produces", () => {
    expect(parseSEK("1234.50")).toBe(1234.5);
    expect(parseSEK("1234,50")).toBe(1234.5);
    expect(parseSEK("1 234,50")).toBe(1234.5);
    expect(parseSEK("1 234,50")).toBe(1234.5); // non-breaking space
  });

  it("reads a return as a negative amount", () => {
    // Stored returns are signed and are read here before a screen shows its magnitude.
    expect(parseSEK("-250")).toBe(-250);
    expect(parseSEK("-1 234,50")).toBe(-1234.5);
  });

  it("falls back to zero on anything unreadable", () => {
    // Runs on every keystroke of a half-typed amount; zero is what the submit gate refuses.
    expect(parseSEK("")).toBe(0);
    expect(parseSEK("abc")).toBe(0);
    expect(parseSEK("-")).toBe(0);
  });
});

describe("parseOre", () => {
  it("goes from typed text straight to integer öre", () => {
    expect(parseOre("1 234,50")).toBe(123450);
    expect(parseOre("19,99")).toBe(1999);
    expect(parseOre("-250")).toBe(-25000);
  });
});

describe("isAmountInput", () => {
  it("takes an amount to the öre, written either way", () => {
    expect(isAmountInput("12,50")).toBe(true);
    expect(isAmountInput("12.50")).toBe(true);
    expect(isAmountInput("1 234,50")).toBe(true);
    expect(isAmountInput("0,01")).toBe(true);
  });

  // Each is a keystroke on the way to an amount.
  it("takes half-typed input", () => {
    expect(isAmountInput("")).toBe(true);
    expect(isAmountInput("12")).toBe(true);
    expect(isAmountInput("12,")).toBe(true);
    expect(isAmountInput("12,5")).toBe(true);
  });

  // A third decimal is not a finer amount: sekToOre would round 12,505 away silently.
  it("stops at two decimals", () => {
    expect(isAmountInput("12,505")).toBe(false);
    expect(isAmountInput("12.5678")).toBe(false);
    expect(sekToOre(12.505)).toBe(1251); // what it would have become
  });

  it("refuses what is not an amount at all", () => {
    expect(isAmountInput("abc")).toBe(false);
    expect(isAmountInput("12,50 kr")).toBe(false);
    expect(isAmountInput("1,2,3")).toBe(false);
  });

  it("refuses everything the keyboard cannot type", () => {
    // A magnitude only: no sign (no phone keypad has one), no operator.
    expect(isAmountInput("-100")).toBe(false);
    expect(isAmountInput("100+200")).toBe(false);
    expect(isAmountInput("100-50")).toBe(false);
  });
});

describe("round trip", () => {
  it("returns the same amount through öre and back", () => {
    for (const sek of [0, 1, 19.99, 123.45, -250, 1234.5, 0.01]) {
      expect(oreToSEK(sekToOre(sek))).toBe(sek);
    }
  });
});

describe("groupForm", () => {
  it("groups a figure the way it is read", () => {
    // A non-breaking space is what Swedish uses and must be taken back when pasted.
    expect(groupForm("1234.5")).toBe("1\u00a0234,50");
    expect(groupForm("700")).toBe("700");
    expect(isAmountInput(groupForm("1234.5"))).toBe(true);
  });

  it("leaves a field with nothing in it alone", () => {
    // Including between the separator and the öre, where formatting would rewrite what is being typed.
    expect(groupForm("")).toBe("");
    expect(groupForm(" ")).toBe(" ");
  });
});

describe("commaForm", () => {
  it("shows back a comma whatever separator was typed", () => {
    // A phone's decimal pad may offer only ".", so it is accepted and shown as a comma.
    expect(commaForm("12.50")).toBe("12,50");
    expect(commaForm("12,50")).toBe("12,50");
  });

  it("leaves an amount with no decimals alone", () => {
    expect(commaForm("1 234")).toBe("1 234");
    expect(commaForm("")).toBe("");
  });

  it("leaves a lone minus alone", () => {
    expect(commaForm("-")).toBe("-");
  });
});

describe("settleAmount", () => {
  it("works a sum out to the öre, in comma form", () => {
    expect(settleAmount("1250*0,25+40")).toBe("352,50");
    expect(settleAmount("100/3")).toBe("33,33");
    expect(settleAmount("(10+5)*2")).toBe("30,00");
    expect(settleAmount("=12*3")).toBe("36,00");
    expect(settleAmount("=150")).toBe("150,00");
  });

  it("leaves a plain amount as typed", () => {
    expect(settleAmount("1 234,5")).toBe("1 234,5");
    expect(settleAmount("")).toBe("");
  });

  it("refuses a sum that does not add up or goes below nothing", () => {
    expect(settleAmount("12+")).toBeNull();
    expect(settleAmount("(1+2")).toBeNull();
    expect(settleAmount("5/0")).toBeNull();
    expect(settleAmount("10-20")).toBeNull();
  });

  it("is what parseSEK reads a sum as", () => {
    expect(parseSEK("1250*0,25+40")).toBe(352.5);
    expect(parseSEK("12+")).toBe(0);
  });
});

describe("isSumInput", () => {
  it("takes digits, separators, spaces, operators and brackets only", () => {
    expect(isSumInput("1 250*0,25+(40-2)/2")).toBe(true);
    expect(isSumInput("12a")).toBe(false);
    expect(isSumInput("=12*3")).toBe(true);
    expect(isSumInput("1=2")).toBe(false);
  });
});
