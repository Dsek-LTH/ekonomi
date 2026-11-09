import { describe, expect, it } from "vitest";
import { expenseScopeWhere, scopeIncludes, type ExpenseScope } from "./expense-scope";

const BOOKKEEPING: ExpenseScope = { everything: true };

const ordinaryMember: ExpenseScope = {
  everything: false,
  userId: "user-1",
  resultUnitPrefixes: [],
};

const resultUnitHead: ExpenseScope = {
  everything: false,
  userId: "user-2",
  resultUnitPrefixes: ["SEX", "KM"],
};

describe("expenseScopeWhere", () => {
  it("filters nothing for a bookkeeping role", () => {
    expect(expenseScopeWhere(BOOKKEEPING)).toEqual({});
  });

  it("limits an ordinary member to their own", () => {
    expect(expenseScopeWhere(ordinaryMember)).toEqual({
      OR: [{ submitterId: "user-1" }],
    });
  });

  it("adds the resultUnits a head is responsible for", () => {
    expect(expenseScopeWhere(resultUnitHead)).toEqual({
      OR: [
        { submitterId: "user-2" },
        {
          allocations: {
            some: {
              costCenter: {
                OR: [{ code: { startsWith: "SEX" } }, { code: { startsWith: "KM" } }],
              },
            },
          },
        },
      ],
    });
  });

  it("never returns an empty OR, which would match nothing", () => {
    // An `OR: []` matches no rows, so a restricted scope must always carry the submitter clause.
    for (const scope of [ordinaryMember, resultUnitHead]) {
      const where = expenseScopeWhere(scope);
      expect(where.OR?.length ?? 0).toBeGreaterThan(0);
    }
  });
});

describe("scopeIncludes", () => {
  const someoneElses = { id: "exp-1", submitterId: "someone-else" };

  it("admits a bookkeeping role to anything", async () => {
    expect(await scopeIncludes(BOOKKEEPING, someoneElses)).toBe(true);
  });

  it("admits anyone to their own", async () => {
    expect(await scopeIncludes(ordinaryMember, { id: "exp-1", submitterId: "user-1" })).toBe(true);
    expect(await scopeIncludes(resultUnitHead, { id: "exp-1", submitterId: "user-2" })).toBe(true);
  });

  it("refuses a member with no resultUnits someone else's, without a query", async () => {
    // No prefixes: no allocation can match, so the query is skipped.
    expect(await scopeIncludes(ordinaryMember, someoneElses)).toBe(false);
  });
});
