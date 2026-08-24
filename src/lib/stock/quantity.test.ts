import { describe, expect, it } from "vitest";
import { evaluate, isExpression, isQuantityInput, quantity } from "./quantity";

describe("evaluate", () => {
  it("reads a plain number", () => {
    expect(evaluate("240")).toBe(240);
  });

  it("does the arithmetic of a delivery", () => {
    // The case it exists for: ten crates of twenty-four and the thirty loose
    // ones on the pallet.
    expect(evaluate("24*10+30")).toBe(270);
  });

  it("keeps the usual precedence", () => {
    expect(evaluate("2+3*4")).toBe(14);
    expect(evaluate("(2+3)*4")).toBe(20);
  });

  it("handles the four operators", () => {
    expect(evaluate("100-8")).toBe(92);
    expect(evaluate("96/4")).toBe(24);
  });

  it("ignores spaces and takes a comma as a decimal point", () => {
    // A Swedish keyboard and a Swedish habit.
    expect(evaluate(" 24 * 3 ")).toBe(72);
    expect(evaluate("1,5*4")).toBe(6);
  });

  it("reads a leading sign as part of the number", () => {
    expect(evaluate("-4")).toBe(-4);
    expect(evaluate("+4")).toBe(4);
  });

  it("has no answer for something half typed", () => {
    // Mid-keystroke states. They must not read as a number, or the field would
    // jump about as somebody types.
    expect(evaluate("24*")).toBeNull();
    expect(evaluate("(24")).toBeNull();
    expect(evaluate("")).toBeNull();
    expect(evaluate("+")).toBeNull();
    expect(evaluate(".")).toBeNull();
  });

  it("refuses anything only partly read", () => {
    // The dangerous shape: a parse that succeeds on a prefix and throws the
    // rest away would turn "4)" into four.
    expect(evaluate("4)")).toBeNull();
    expect(evaluate("24*3)")).toBeNull();
  });

  it("closes a gap in a number rather than reading two", () => {
    // Space is stripped before anything is read, which is what lets "24 * 3"
    // work at all — and it means a stray space inside a number closes up. That
    // is the right way round: somebody typing "2 40" meant 240, and the
    // alternative is refusing "24 * 3".
    expect(evaluate("4 4")).toBe(44);
  });

  it("has no answer for division by nothing", () => {
    // Infinity would sail through every comparison as false.
    expect(evaluate("24/0")).toBeNull();
  });

  it("does not run what it is given", () => {
    // The reason this is parsed rather than evaluated: a field that is
    // sometimes filled in from a scanner must not be a place to put code.
    expect(evaluate("alert(1)")).toBeNull();
    expect(evaluate("1;2")).toBeNull();
    expect(evaluate("process.exit")).toBeNull();
  });
});

describe("isQuantityInput", () => {
  it("accepts the characters a sum is made of", () => {
    expect(isQuantityInput("24*10+30")).toBe(true);
    expect(isQuantityInput("(1,5)")).toBe(true);
    expect(isQuantityInput("")).toBe(true);
  });

  it("refuses letters as they are typed", () => {
    expect(isQuantityInput("24a")).toBe(false);
    expect(isQuantityInput("abc")).toBe(false);
  });
});

describe("quantity", () => {
  it("gives back the sum, rounded to a whole thing", () => {
    // Half a can is not a quantity.
    expect(quantity("24*10+30")).toEqual({ value: 270, ok: true, capped: false });
    expect(quantity("1,5")).toEqual({ value: 2, ok: true, capped: false });
  });

  it("holds at nothing rather than going negative", () => {
    // You cannot take a negative number of bottles off a shelf.
    expect(quantity("-5")).toEqual({ value: 0, ok: true, capped: false });
    expect(quantity("4-10")).toEqual({ value: 0, ok: true, capped: false });
  });

  it("holds at what there is, and says it did", () => {
    // Twenty-two are out, so twenty-two is the most that can come home — and
    // the screen gets to mention it rather than the number quietly changing.
    expect(quantity("30", 22)).toEqual({ value: 22, ok: true, capped: true });
    expect(quantity("22", 22)).toEqual({ value: 22, ok: true, capped: false });
    expect(quantity("24*2", 22)).toEqual({ value: 22, ok: true, capped: true });
  });

  it("counts nothing for text that does not add up", () => {
    expect(quantity("24*")).toEqual({ value: 0, ok: false, capped: false });
    expect(quantity("")).toEqual({ value: 0, ok: false, capped: false });
  });

  it("takes a ceiling of nothing as nothing", () => {
    // A rung with no bottles on it: anything typed there comes to zero.
    expect(quantity("5", 0)).toEqual({ value: 0, ok: true, capped: true });
  });
});

describe("isExpression", () => {
  it("knows a sum from a figure", () => {
    expect(isExpression("24*10+30")).toBe(true);
    expect(isExpression("(4)")).toBe(true);
    expect(isExpression("240")).toBe(false);
    expect(isExpression(" 240 ")).toBe(false);
    expect(isExpression("")).toBe(false);
  });

  it("counts a signed number as one, because it is", () => {
    expect(isExpression("-5")).toBe(true);
  });
});
