import { describe, expect, it } from "vitest";
import type { Capability, Role } from "@/lib/domain/types";
import { DEFAULT_ROLE_CAPABILITIES } from "@/lib/server/authority-defaults";
import {
  ASSIGNABLE_ROLES,
  CAPABILITIES,
  ROLES,
  canAccessBookkeeping,
  canAccessBudget,
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
// app: every nav item, page and API route defers to them, so each case below
// is a policy decision written down, not a coverage exercise.
//
// Which roles hold which capability is a table now (Inställningar → Roller), so
// the policy is no longer a property of this file. It moved one step out, into
// the defaults the section starts from, and that is where the old cases are
// asserted: `caps("ORDFORANDE")` below is what the chair can do on the day the
// database is created, and every "deliberately narrow gate" this app has is
// still written down here as a sentence about it.
//
// What is tested against the helpers themselves is the part that stayed code:
// the attest rule, which is not a capability and cannot become one.
const defaults = (role: Role): Capability[] =>
  DEFAULT_ROLE_CAPABILITIES.filter((r) => r.role === role).map((r) => r.capability);

describe("the defaults the section starts from", () => {
  it("makes the treasurer and the chair admins, and nobody else", () => {
    expect(isAdmin(defaults("SKATTMASTARE"))).toBe(true);
    expect(isAdmin(defaults("ORDFORANDE"))).toBe(true);
    expect(isAdmin(defaults("VICE_SKATTMASTARE"))).toBe(false);
    expect(isAdmin(defaults("RESULTATANSVARIG"))).toBe(false);
    expect(isAdmin(defaults("ORDINARIE"))).toBe(false);
  });

  it("gives bookkeeping access to the treasury and the chair", () => {
    for (const role of [
      "SKATTMASTARE",
      "ORDFORANDE",
      "VICE_SKATTMASTARE",
      "SKATTFORMAN",
    ] as Role[]) {
      expect(canAccessBookkeeping(defaults(role))).toBe(true);
    }
    expect(canAccessBookkeeping(defaults("RESULTATANSVARIG"))).toBe(false);
    expect(canAccessBookkeeping(defaults("ORDINARIE"))).toBe(false);
  });

  it("keeps the chair out of settings, despite counting as an admin elsewhere", () => {
    expect(isAdmin(defaults("ORDFORANDE"))).toBe(true);
    expect(canAccessSettings(defaults("ORDFORANDE"))).toBe(false);
    expect(canAccessSettings(defaults("SKATTMASTARE"))).toBe(true);
  });

  it("keeps the chair out of unexporting, that is treasury cleanup work", () => {
    expect(canUnexport(defaults("ORDFORANDE"))).toBe(false);
    expect(canUnexport(defaults("SKATTFORMAN"))).toBe(true);
  });

  it("leaves locking a budget, and departing from a locked one, to the treasurer alone", () => {
    expect(canLockBudget(defaults("SKATTMASTARE"))).toBe(true);
    expect(canLockBudget(defaults("ORDFORANDE"))).toBe(false);
    expect(canChangeLockedBudget(defaults("SKATTMASTARE"))).toBe(true);
    expect(canChangeLockedBudget(defaults("ORDFORANDE"))).toBe(false);
  });

  it("lets resultUnit heads comment on a budget without being able to edit it", () => {
    expect(canCommentBudget(defaults("RESULTATANSVARIG"))).toBe(true);
    expect(isAdmin(defaults("RESULTATANSVARIG"))).toBe(false);
    expect(canCommentBudget(defaults("ORDINARIE"))).toBe(false);
  });

  it("shows the attest queue to everyone who could ever attest something", () => {
    for (const role of [
      "SKATTMASTARE",
      "ORDFORANDE",
      "RESULTATANSVARIG",
    ] as Role[]) {
      expect(hasAttestRole(defaults(role))).toBe(true);
    }
    // The skattförman books rather than attests, and the vice no longer
    // attests anything (Policy för ekonomi names nobody but firmatecknare and
    // resultatansvarig), so neither has a queue to see.
    expect(hasAttestRole(defaults("SKATTFORMAN"))).toBe(false);
    expect(hasAttestRole(defaults("VICE_SKATTMASTARE"))).toBe(false);
    expect(hasAttestRole(defaults("ORDINARIE"))).toBe(false);
  });

  it("leaves the budget open to the whole section", () => {
    // `canAccessBudget` was `() => true`. Making it a row must not have quietly
    // narrowed it. The budget is the section's, not the treasury's.
    for (const role of ROLES) expect(canAccessBudget(defaults(role))).toBe(true);
  });

  it("leaves somebody able to reach Inställningar", () => {
    // The invariant the whole feature rests on, asserted at its starting point.
    // Enforced on every write in lib/server/capabilities.ts.
    expect(ROLES.some((role) => canAccessSettings(defaults(role)))).toBe(true);
  });

  it("grants nothing the app does not ask about", () => {
    // A row for a capability no call site checks would be a tickbox that does
    // nothing. CAPABILITIES is the list the settings grid draws, so it is also
    // the list a default is allowed to name.
    for (const { capability } of DEFAULT_ROLE_CAPABILITIES) {
      expect(CAPABILITIES).toContain(capability);
    }
  });
});

describe("the helpers themselves", () => {
  it("read the whole capability set, not the first entry", () => {
    expect(isAdmin(["SETTINGS", "ADMIN"])).toBe(true);
  });

  it("grant nothing to somebody with no capabilities at all", () => {
    // A role the grid says nothing about. Not an error. It is what "this role
    // exists but does nothing yet" looks like.
    const none: Capability[] = [];
    expect(isAdmin(none)).toBe(false);
    expect(canAccessSettings(none)).toBe(false);
    expect(canAccessBookkeeping(none)).toBe(false);
    expect(canAccessBudget(none)).toBe(false);
  });
});

describe("canAttestAllocation", () => {
  // One allocation, on a cost centre belonging to Sexmästeriet. Each test below
  // changes only what it is about.
  const base = {
    actorCapabilities: [] as Capability[],
    actorRoles: ["ORDINARIE"] as Role[],
    actorIsSubmitter: false,
    actorOwnedResultUnits: [] as string[],
    allocationResultUnit: "Sexmästeriet" as string | null,
  };
  const admin = { actorCapabilities: ["ADMIN"] as Capability[] };

  it("never lets anyone attest their own expense, whatever they hold", () => {
    expect(canAttestAllocation({ ...base, ...admin, actorIsSubmitter: true })).toBe(false);
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
    expect(canAttestAllocation({ ...base, ...admin })).toBe(true);
    // Including an expense with no result unit behind its cost centre.
    expect(canAttestAllocation({ ...base, ...admin, allocationResultUnit: null })).toBe(true);
  });

  it("reads admin authority off the capability, not off a role name", () => {
    // Which roles are admins is editable; that admins attest anything is not.
    // Someone holding no listed role but granted ADMIN still attests.
    expect(canAttestAllocation({ ...base, actorRoles: [], ...admin })).toBe(true);
    // And the treasurer's role name alone grants nothing if the grid took ADMIN
    // away from it.
    expect(canAttestAllocation({ ...base, actorRoles: ["SKATTMASTARE"] })).toBe(false);
  });

  it("gives the vice treasurer no attest authority of their own", () => {
    // Policy för ekonomi names firmatecknare and resultatansvarig, and nobody
    // else. The vice used to attest ordinary members' expenses.
    expect(canAttestAllocation({ ...base, actorRoles: ["VICE_SKATTMASTARE"] })).toBe(false);
  });

  it("lets a resultUnit head attest only their own resultUnit's allocations", () => {
    const head = {
      ...base,
      actorRoles: ["RESULTATANSVARIG"] as Role[],
      actorOwnedResultUnits: ["Sexmästeriet"],
    };
    expect(canAttestAllocation(head)).toBe(true);
    expect(canAttestAllocation({ ...head, allocationResultUnit: "Källarmästeriet" })).toBe(false);
    // An unassigned cost centre belongs to no result unit, so no head owns it,
    // it falls to an admin.
    expect(canAttestAllocation({ ...head, allocationResultUnit: null })).toBe(false);
  });

  it("gives an ordinary member no attest authority at all", () => {
    expect(canAttestAllocation(base)).toBe(false);
  });

  it("takes authority from the role, not from a stale ownership row", () => {
    // Someone who answers for a result unit on their row but has lost the role
    // gets nothing. The roles are what the check reads.
    expect(
      canAttestAllocation({
        ...base,
        actorRoles: ["ORDINARIE"],
        actorOwnedResultUnits: ["Sexmästeriet"],
      }),
    ).toBe(false);
  });
});

describe("the vocabulary", () => {
  it("leaves the baseline every member already holds out of the assignable set", () => {
    expect(ASSIGNABLE_ROLES).not.toContain("ORDINARIE");
    expect(ASSIGNABLE_ROLES).toContain("SKATTMASTARE");
  });

  it("draws every capability in the grid, exactly once", () => {
    // The grid is built from CAPABILITIES, so a value missing from it would be
    // a permission nobody could ever grant, and a duplicate would be two
    // tickboxes writing the same row.
    expect([...new Set(CAPABILITIES)]).toHaveLength(CAPABILITIES.length);
  });
});
