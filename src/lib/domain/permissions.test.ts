import { describe, expect, it } from "vitest";
import type { Role } from "@/lib/domain/types";
import {
  ASSIGNABLE_ROLES,
  canAccessBookkeeping,
  canAccessSettings,
  canAttestAllocation,
  canChangeLockedBudget,
  canCommentBudget,
  canLockBudget,
  canUnexport,
  hasAttestRole,
  isAdmin,
} from "./permissions";

// The authority these functions grant is the whole access-control story of the
// app — every nav item, page and API route defers to them — so each case below
// is a policy decision written down, not a coverage exercise.

describe("isAdmin", () => {
  it("is the treasurer and the chair, and nobody else", () => {
    expect(isAdmin(["SKATTMASTARE"])).toBe(true);
    expect(isAdmin(["ORDFORANDE"])).toBe(true);
    expect(isAdmin(["VICE_SKATTMASTARE"])).toBe(false);
    expect(isAdmin(["RESULTATANSVARIG"])).toBe(false);
    expect(isAdmin(["ORDINARIE"])).toBe(false);
    expect(isAdmin([])).toBe(false);
  });

  it("reads the whole role set, not the first role", () => {
    expect(isAdmin(["ORDINARIE", "SKATTMASTARE"])).toBe(true);
  });
});

describe("bookkeeping access", () => {
  it("covers the treasury and the chair", () => {
    for (const role of ["SKATTMASTARE", "ORDFORANDE", "VICE_SKATTMASTARE", "SKATTFORMAN"] as Role[]) {
      expect(canAccessBookkeeping([role])).toBe(true);
    }
  });

  it("excludes resultUnit heads and ordinary members", () => {
    expect(canAccessBookkeeping(["RESULTATANSVARIG"])).toBe(false);
    expect(canAccessBookkeeping(["ORDINARIE"])).toBe(false);
  });
});

describe("the deliberately narrow gates", () => {
  it("keeps the chair out of settings, despite counting as an admin elsewhere", () => {
    expect(isAdmin(["ORDFORANDE"])).toBe(true);
    expect(canAccessSettings(["ORDFORANDE"])).toBe(false);
    expect(canAccessSettings(["SKATTMASTARE"])).toBe(true);
  });

  it("keeps the chair out of unexporting — that is treasury cleanup work", () => {
    expect(canUnexport(["ORDFORANDE"])).toBe(false);
    expect(canUnexport(["SKATTFORMAN"])).toBe(true);
  });

  it("leaves locking a budget, and departing from a locked one, to the treasurer alone", () => {
    expect(canLockBudget(["SKATTMASTARE"])).toBe(true);
    expect(canLockBudget(["ORDFORANDE"])).toBe(false);
    expect(canChangeLockedBudget(["SKATTMASTARE"])).toBe(true);
    expect(canChangeLockedBudget(["ORDFORANDE"])).toBe(false);
  });

  it("lets resultUnit heads comment on a budget without being able to edit it", () => {
    expect(canCommentBudget(["RESULTATANSVARIG"])).toBe(true);
    expect(isAdmin(["RESULTATANSVARIG"])).toBe(false);
    expect(canCommentBudget(["ORDINARIE"])).toBe(false);
  });
});

describe("hasAttestRole", () => {
  it("admits everyone who could ever attest something", () => {
    for (const role of ["SKATTMASTARE", "ORDFORANDE", "VICE_SKATTMASTARE", "RESULTATANSVARIG"] as Role[]) {
      expect(hasAttestRole([role])).toBe(true);
    }
  });

  it("excludes the skattförman, who books rather than attests", () => {
    expect(hasAttestRole(["SKATTFORMAN"])).toBe(false);
    expect(hasAttestRole(["ORDINARIE"])).toBe(false);
  });
});

describe("canAttestAllocation", () => {
  // One allocation, on a cost centre belonging to Sexmästeriet, submitted by an
  // ordinary member. Each test below changes only what it is about.
  const base = {
    actorRoles: ["ORDINARIE"] as Role[],
    actorIsSubmitter: false,
    actorOwnedResultUnits: [] as string[],
    submitterRoles: ["ORDINARIE"] as Role[],
    allocationResultUnit: "Sexmästeriet" as string | null,
  };

  it("never lets anyone attest their own expense, whatever they hold", () => {
    expect(
      canAttestAllocation({ ...base, actorRoles: ["SKATTMASTARE"], actorIsSubmitter: true }),
    ).toBe(false);
    expect(
      canAttestAllocation({
        ...base,
        actorRoles: ["RESULTATANSVARIG"],
        actorIsSubmitter: true,
        actorOwnedResultUnits: ["Sexmästeriet"],
      }),
    ).toBe(false);
  });

  it("lets an admin attest anything", () => {
    expect(canAttestAllocation({ ...base, actorRoles: ["SKATTMASTARE"] })).toBe(true);
    expect(canAttestAllocation({ ...base, actorRoles: ["ORDFORANDE"] })).toBe(true);
    // Including an expense with no result unit behind its cost centre.
    expect(
      canAttestAllocation({ ...base, actorRoles: ["ORDFORANDE"], allocationResultUnit: null }),
    ).toBe(true);
  });

  it("lets the vice treasurer attest expenses from ordinary members", () => {
    expect(canAttestAllocation({ ...base, actorRoles: ["VICE_SKATTMASTARE"] })).toBe(true);
  });

  it("stops the vice treasurer attesting an elevated member's expense", () => {
    // The point of the rule: the people who run the section get attested by
    // someone above them, not by the vice.
    for (const submitter of ["SKATTMASTARE", "ORDFORANDE", "RESULTATANSVARIG"] as Role[]) {
      expect(
        canAttestAllocation({
          ...base,
          actorRoles: ["VICE_SKATTMASTARE"],
          submitterRoles: [submitter],
        }),
      ).toBe(false);
    }
  });

  it("lets a resultUnit head attest only their own resultUnit's allocations", () => {
    const head = {
      ...base,
      actorRoles: ["RESULTATANSVARIG"] as Role[],
      actorOwnedResultUnits: ["Sexmästeriet"],
    };
    expect(canAttestAllocation(head)).toBe(true);
    expect(canAttestAllocation({ ...head, allocationResultUnit: "Källarmästeriet" })).toBe(false);
    // An unassigned cost centre belongs to no result unit, so no head owns it —
    // it falls to an admin.
    expect(canAttestAllocation({ ...head, allocationResultUnit: null })).toBe(false);
  });

  it("gives an ordinary member no attest authority at all", () => {
    expect(canAttestAllocation(base)).toBe(false);
  });

  it("takes authority from the role, not from a stale ownership row", () => {
    // Someone who answers for a result unit in the join table but has lost the role
    // gets nothing — the roles are what the check reads.
    expect(
      canAttestAllocation({
        ...base,
        actorRoles: ["ORDINARIE"],
        actorOwnedResultUnits: ["Sexmästeriet"],
      }),
    ).toBe(false);
  });
});

describe("ASSIGNABLE_ROLES", () => {
  it("leaves out the baseline every member already holds", () => {
    expect(ASSIGNABLE_ROLES).not.toContain("ORDINARIE");
    expect(ASSIGNABLE_ROLES).toContain("SKATTMASTARE");
  });
});
