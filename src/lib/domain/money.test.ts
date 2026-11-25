import { describe, expect, it } from "vitest";
import {
  fullAmountForm,
  isAmountInput,
  isSumInput,
  settleAmount,
  oreToSEK,
  parseOre,
  parseSEK,
  sekToInput,
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

describe("sekToInput", () => {
  it("writes an amount grouped, with a comma and two decimals", () => {
    expect(sekToInput(1000)).toBe("1 000,00");
    expect(sekToInput(1234.5)).toBe("1 234,50");
    expect(sekToInput(1234567.89)).toBe("1 234 567,89");
    expect(sekToInput(700)).toBe("700,00");
    expect(sekToInput(0.05)).toBe("0,05");
    expect(sekToInput(0)).toBe("0,00");
  });

  it("keeps the sign of a stored return, with a plain minus", () => {
    expect(sekToInput(-1234.5)).toBe("-1 234,50");
  });

  it("is empty for no amount", () => {
    expect(sekToInput(null)).toBe("");
  });

  it("is something an amount field takes back as typed", () => {
    expect(isAmountInput(sekToInput(1234567.89))).toBe(true);
    expect(parseSEK(sekToInput(1234567.89))).toBe(1234567.89);
  });
});

describe("fullAmountForm", () => {
  it("writes the amount out with two decimals and a comma", () => {
    expect(fullAmountForm("700")).toBe("700,00");
    expect(fullAmountForm("1000")).toBe("1 000,00");
    expect(fullAmountForm("1234.5")).toBe("1 234,50");
    expect(fullAmountForm("1 234,5")).toBe("1 234,50");
    expect(fullAmountForm("12,")).toBe("12,00");
  });

  it("gives back what it was handed once a field holds its own form", () => {
    // Leave the field, enter it again, leave again: the text does not move.
    const left = fullAmountForm("1000");
    expect(fullAmountForm(left)).toBe(left);
    // A non-breaking space pasted from elsewhere is read too.
    expect(fullAmountForm("1\u00a0000,5")).toBe("1 000,50");
  });

  it("leaves a blank field blank", () => {
    expect(fullAmountForm("")).toBe("");
    expect(fullAmountForm(" ")).toBe(" ");
  });
});

describe("settleAmount", () => {
  it("works a sum out to the öre, as an amount field writes it", () => {
    expect(settleAmount("1250*0,25+40")).toBe("352,50");
    expect(settleAmount("1000*2")).toBe("2 000,00");
    expect(settleAmount("100/3")).toBe("33,33");
    expect(settleAmount("(10+5)*2")).toBe("30,00");
    expect(settleAmount("=12*3")).toBe("36,00");
    expect(settleAmount("=150")).toBe("150,00");
  });

  it("writes a plain amount in full, as an amount field does", () => {
    expect(settleAmount("1234,5")).toBe("1 234,50");
    expect(settleAmount("1 234,50")).toBe("1 234,50");
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
