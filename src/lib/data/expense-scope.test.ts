import { describe, expect, it } from "vitest";
import { expenseScopeWhere, scopeIncludes, type ExpenseScope } from "./expense-scope";

// Who may see which utlägg. This rule used to be written out three times: as a
// list filter, as a check inside the detail loader, and again in the API, so
// these tests pin the one statement of it that all three now derive from.
//
// `expenseScopeOf` itself reads result unit ownerships from the database and is
// out of scope here; what is tested is everything derived from the scope value.

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
    // The empty filter has to compose into any `where` without a special case
    // at the call site. That is what lets the loaders apply it unconditionally.
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
              costCenter: { OR: [{ code: { startsWith: "SEX" } }, { code: { startsWith: "KM" } }] },
            },
          },
        },
      ],
    });
  });

  it("never returns an empty OR, which would match nothing", () => {
    // An `OR: []` in Prisma matches no rows at all. Every restricted scope must
    // therefore carry at least the submitter clause, otherwise a member with
    // no result units would lose sight of their own utlägg.
    for (const scope of [ordinaryMember, resultUnitHead]) {
      const where = expenseScopeWhere(scope);
      expect(where.OR?.length ?? 0).toBeGreaterThan(0);
    }
  });
});

// The three cases below all resolve from the scope alone. Only a resultatansvarig
// asking about someone else's utlägg reaches for the database, which is why
// that one case is absent here.
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
    // The short circuit is the point: no prefixes means no allocation can
    // match, so the query is skipped rather than run to learn nothing.
    expect(await scopeIncludes(ordinaryMember, someoneElses)).toBe(false);
  });
});
