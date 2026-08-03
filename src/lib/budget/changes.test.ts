import { describe, expect, it } from "vitest";
import {
  adjustmentsByAccount,
  changeLabel,
  isActive,
  netResultImpact,
  parseAmount,
  resultImpact,
  scopeKey,
  scopeLabel,
  validateChange,
  type ResolvedEntry,
} from "./changes";

// Sexmästeriet's two sheets, and one belonging to nobody.
const entry = (
  over: Partial<ResolvedEntry> & Pick<ResolvedEntry, "accountId" | "amount" | "kind">,
): ResolvedEntry => ({
  scope: "resultatenhet:Sexmästeriet",
  scopeLabel: "Sexmästeriet",
  ...over,
});

const cost = (accountId: string, amount: number, over: Partial<ResolvedEntry> = {}) =>
  entry({ accountId, amount, kind: "COST", ...over });
const income = (accountId: string, amount: number, over: Partial<ResolvedEntry> = {}) =>
  entry({ accountId, amount, kind: "INCOME", ...over });

describe("resultImpact", () => {
  // Both kinds are budgeted as positive magnitudes, so the sign has to be put
  // back before they can meet in one sum.
  it("lifts the result by added income and drops it by added cost", () => {
    expect(resultImpact("INCOME", 500)).toBe(500);
    expect(resultImpact("COST", 500)).toBe(-500);
  });

  it("carries a reduction the other way", () => {
    expect(resultImpact("COST", -500)).toBe(500);
  });
});

describe("netResultImpact", () => {
  it("nets income against cost", () => {
    expect(netResultImpact([{ kind: "INCOME", amount: 500 }, { kind: "COST", amount: 500 }])).toBe(0);
  });

  it("is zero for money moved between two cost accounts", () => {
    expect(netResultImpact([{ kind: "COST", amount: 500 }, { kind: "COST", amount: -500 }])).toBe(0);
  });
});

describe("validateChange", () => {
  it("refuses a change with no entries", () => {
    expect(validateChange("AVSTEG", [])).toEqual({ ok: false, error: "empty" });
  });

  it("refuses an entry that isn't a number", () => {
    const v = validateChange("AVSTEG", [cost("a", NaN)]);
    expect(v).toEqual({ ok: false, error: "notNumbers" });
  });

  it("refuses a change where every amount is zero", () => {
    expect(validateChange("AVSTEG", [cost("a", 0), cost("b", 0)])).toEqual({
      ok: false,
      error: "allZero",
    });
  });

  it("refuses the same account twice — it reads as two decisions", () => {
    const v = validateChange("AVSTEG", [cost("a", 500), cost("a", -500)]);
    expect(v).toEqual({ ok: false, error: "duplicate" });
  });

  describe("AVSTEG — must actually move the rambudget", () => {
    it("accepts a change that moves it", () => {
      expect(validateChange("AVSTEG", [cost("a", 500)])).toEqual({ ok: true });
    });

    it("refuses one that nets to nothing — that is a förflyttning", () => {
      const v = validateChange("AVSTEG", [cost("a", 500), cost("b", -500)]);
      expect(v).toEqual({ ok: false, error: "noEffect" });
    });
  });

  describe("FORFLYTTNING — must net to zero, inside one resultatenhet", () => {
    it("accepts money moved between two cost accounts", () => {
      expect(validateChange("FORFLYTTNING", [cost("a", 500), cost("b", -500)])).toEqual({
        ok: true,
      });
    });

    it("accepts a rise in income paying for a rise in cost", () => {
      expect(validateChange("FORFLYTTNING", [income("a", 500), cost("b", 500)])).toEqual({
        ok: true,
      });
    });

    it("refuses one that changes the rambudget, and says by how much", () => {
      const v = validateChange("FORFLYTTNING", [cost("a", 500), cost("b", -200)]);
      expect(v.ok).toBe(false);
      if (v.ok) return;
      expect(v.error).toBe("notNeutral");
      // Signed, because which way it moved is the useful half.
      expect(v.values?.net).toBe("-300");
    });

    it("refuses one that crosses resultatenheter, and names them", () => {
      const v = validateChange("FORFLYTTNING", [
        cost("a", 500),
        cost("b", -500, { scope: "resultatenhet:Källarmästeriet", scopeLabel: "Källarmästeriet" }),
      ]);
      expect(v.ok).toBe(false);
      if (v.ok) return;
      expect(v.error).toBe("crossesScopes");
      expect(v.values?.scopes).toBe("Sexmästeriet, Källarmästeriet");
    });

    // Kronor typed by hand and summed as doubles: two that should cancel can
    // miss by a fraction of an öre, and that is not a real imbalance.
    it("treats a sub-öre residue as balanced", () => {
      expect(validateChange("FORFLYTTNING", [cost("a", 0.1), cost("b", -0.1)])).toEqual({
        ok: true,
      });
    });
  });
});

describe("scopeKey", () => {
  it("keys a linked sheet on its result unit, so its siblings can fund it", () => {
    expect(scopeKey({ id: "s1", costCenter: { resultUnit: "Sexmästeriet" } })).toBe(
      "resultatenhet:Sexmästeriet",
    );
  });

  // The one thing this key exists to prevent: two unrelated orphan sheets
  // sharing a bucket and so being allowed to fund each other.
  it("gives an unlinked sheet a resultatenhet of its own", () => {
    expect(scopeKey({ id: "s1", costCenter: null })).toBe("blad:s1");
    expect(scopeKey({ id: "s2", costCenter: null })).toBe("blad:s2");
  });

  it("treats a blank result unit as none", () => {
    expect(scopeKey({ id: "s1", costCenter: { resultUnit: "  " } })).toBe("blad:s1");
  });
});

describe("scopeLabel", () => {
  it("uses the result unit when there is one", () => {
    expect(scopeLabel({ costCenter: { resultUnit: "Sexmästeriet" } }, "detta blad")).toBe(
      "Sexmästeriet",
    );
  });

  it("falls back when there isn't", () => {
    expect(scopeLabel({ costCenter: null }, "detta blad")).toBe("detta blad");
  });
});

describe("parseAmount", () => {
  it("reads a plain number", () => {
    expect(parseAmount("500")).toBe(500);
    expect(parseAmount(500)).toBe(500);
  });

  it("reads the way a Swede writes one", () => {
    expect(parseAmount("1 234,50")).toBe(1234.5);
    expect(parseAmount("1_234.50")).toBe(1234.5);
  });

  it("keeps the sign", () => {
    expect(parseAmount("-500")).toBe(-500);
    expect(parseAmount("+500")).toBe(500);
  });

  // Unlike a line item, a change is a decided amount and takes no formula.
  it("refuses anything that isn't a number", () => {
    expect(parseAmount("=2*300")).toBeNaN();
    expect(parseAmount("TROJA_POLICY")).toBeNaN();
    expect(parseAmount("")).toBeNaN();
    expect(parseAmount(Infinity)).toBeNaN();
  });
});

describe("adjustmentsByAccount", () => {
  const active = { kind: "AVSTEG" as const, revokedAt: null };

  it("sums every active change per account", () => {
    const got = adjustmentsByAccount([
      { ...active, entries: [{ accountId: "a", amount: 500 }] },
      { ...active, entries: [{ accountId: "a", amount: 200 }, { accountId: "b", amount: -100 }] },
    ]);
    expect(got.get("a")).toBe(700);
    expect(got.get("b")).toBe(-100);
  });

  // The whole reason every figure goes through here.
  it("leaves a revoked change out of the figures", () => {
    const got = adjustmentsByAccount([
      { ...active, entries: [{ accountId: "a", amount: 500 }] },
      { kind: "AVSTEG", revokedAt: new Date(), entries: [{ accountId: "a", amount: 900 }] },
    ]);
    expect(got.get("a")).toBe(500);
  });

  it("accepts a revokedAt that arrived as a string over the wire", () => {
    const got = adjustmentsByAccount([
      { kind: "AVSTEG", revokedAt: "2026-07-01T00:00:00.000Z", entries: [{ accountId: "a", amount: 900 }] },
    ]);
    expect(got.size).toBe(0);
  });
});

describe("isActive", () => {
  it("is true until revoked", () => {
    expect(isActive({ revokedAt: null })).toBe(true);
    expect(isActive({ revokedAt: new Date() })).toBe(false);
  });
});

describe("changeLabel", () => {
  it("names a change the way it is stored", () => {
    expect(changeLabel("AVSTEG", 4)).toBe("Avsteg #4");
    expect(changeLabel("FORFLYTTNING", 7)).toBe("Förflyttning #7");
  });
});
