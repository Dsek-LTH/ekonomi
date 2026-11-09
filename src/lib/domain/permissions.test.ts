import { describe, expect, it } from "vitest";
import type { Capability, Role } from "@/lib/domain/types";
import { DEFAULT_ROLE_CAPABILITIES } from "@/lib/server/authority-defaults";
import {
  ASSIGNABLE_ROLES,
  CAPABILITIES,
  ROLES,
  canAccessBudget,
  canAccessSettings,
  canAttestAllocation,
  canAuditReview,
  canBookkeep,
  canChangeLockedBudget,
  canCommentBudget,
  canLockBudget,
  canUnexport,
  canViewBookkeeping,
  hasAttestRole,
  isAdmin,
} from "./permissions";

// Each case is a policy decision written down. Which roles hold which capability is a table (Inställningar → Roller),
// so `caps("ORDFORANDE")` is what the chair can do on the day the database is created. The attest rule is the part that stayed code.
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
      expect(canBookkeep(defaults(role))).toBe(true);
      expect(canViewBookkeeping(defaults(role))).toBe(true);
    }
    expect(canBookkeep(defaults("RESULTATANSVARIG"))).toBe(false);
    expect(canBookkeep(defaults("ORDINARIE"))).toBe(false);
    expect(canViewBookkeeping(defaults("ORDINARIE"))).toBe(false);
  });

  it("lets a revisor read everything and change nothing", () => {
    const revisor = defaults("REVISOR");
    expect(canViewBookkeeping(revisor)).toBe(true);
    expect(canAccessBudget(revisor)).toBe(true);
    // Every capability that acts, written out so a new one has to be placed on one side of this line.
    const acting: Capability[] = [
      "ADMIN",
      "SETTINGS",
      "BOOKKEEPING",
      "FORTNOX_LOGIN",
      "EXPORT_UNDO",
      "REVIEW_OWN_BOOKING",
      "EXPENSE_DEADLINE_WAIVE",
      "SEND_REMINDERS",
      "STOCK_MANAGE",
      "BUDGET_COMMENT",
      "BUDGET_LOCK",
      "BUDGET_CHANGE_LOCKED",
      "CONTRACT_MANAGE",
      "RENTAL_MANAGE",
      "FIRMATECKNARE",
    ];
    for (const cap of acting) expect(revisor).not.toContain(cap);
    expect(canBookkeep(revisor)).toBe(false);
    expect(canAuditReview(revisor)).toBe(true);
  });

  it("keeps the treasury out of the revisorer's pass", () => {
    for (const role of [
      "SKATTMASTARE",
      "ORDFORANDE",
      "VICE_SKATTMASTARE",
      "SKATTFORMAN",
    ] as Role[]) {
      expect(canAuditReview(defaults(role))).toBe(false);
    }
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
    for (const role of ["SKATTMASTARE", "ORDFORANDE", "RESULTATANSVARIG"] as Role[]) {
      expect(hasAttestRole(defaults(role))).toBe(true);
    }
    // The skattförman books rather than attests, and the vice attests nothing (Policy för ekonomi), so neither has a queue.
    expect(hasAttestRole(defaults("SKATTFORMAN"))).toBe(false);
    expect(hasAttestRole(defaults("VICE_SKATTMASTARE"))).toBe(false);
    expect(hasAttestRole(defaults("ORDINARIE"))).toBe(false);
  });

  it("leaves the budget open to the whole section", () => {
    // Making `canAccessBudget` a row must not have narrowed it.
    for (const role of ROLES) expect(canAccessBudget(defaults(role))).toBe(true);
  });

  it("leaves somebody able to reach Inställningar", () => {
    // The invariant the feature rests on, enforced on every write in lib/server/capabilities.ts.
    expect(ROLES.some((role) => canAccessSettings(defaults(role)))).toBe(true);
  });

  it("grants nothing the app does not ask about", () => {
    // CAPABILITIES is the list the settings grid draws, so it is the list a default may name.
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
    // A role the grid says nothing about: it exists but does nothing yet.
    const none: Capability[] = [];
    expect(isAdmin(none)).toBe(false);
    expect(canAccessSettings(none)).toBe(false);
    expect(canBookkeep(none)).toBe(false);
    expect(canViewBookkeeping(none)).toBe(false);
    expect(canAccessBudget(none)).toBe(false);
  });
});

describe("canAttestAllocation", () => {
  // One allocation on a Sexmästeriet cost centre; each test changes only what it is about.
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
    expect(canAttestAllocation({ ...base, ...admin, allocationResultUnit: null })).toBe(true);
  });

  it("reads admin authority off the capability, not off a role name", () => {
    // Admin comes from the capability, not a role name.
    expect(canAttestAllocation({ ...base, actorRoles: [], ...admin })).toBe(true);
    // A treasurer role alone grants nothing if the grid took ADMIN away.
    expect(canAttestAllocation({ ...base, actorRoles: ["SKATTMASTARE"] })).toBe(false);
  });

  it("gives the vice treasurer no attest authority of their own", () => {
    // Policy för ekonomi names firmatecknare and resultatansvarig only.
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
    // An unassigned cost centre belongs to no result unit, so it falls to an admin.
    expect(canAttestAllocation({ ...head, allocationResultUnit: null })).toBe(false);
  });

  it("gives an ordinary member no attest authority at all", () => {
    expect(canAttestAllocation(base)).toBe(false);
  });

  it("takes authority from the role, not from a stale ownership row", () => {
    // Someone who answers for a unit on their row but lost the role gets nothing: the roles are what the check reads.
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
    // A value missing from CAPABILITIES is a permission nobody can grant; a duplicate is two tickboxes on one row.
    expect([...new Set(CAPABILITIES)]).toHaveLength(CAPABILITIES.length);
  });
});
