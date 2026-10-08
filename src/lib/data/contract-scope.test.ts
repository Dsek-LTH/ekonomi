import { describe, expect, it } from "vitest";
import {
  canManageKind,
  contractScopeOf,
  contractScopeWhere,
  scopeIncludes,
  type Viewer,
} from "./contract-scope";
import type { Capability } from "@/lib/domain/types";

// The rule that keeps an uthyrningsansvarig out of the sponsoravtal. Worth
// testing rather than trusting, because every query and every route leans on
// it, and the failure is silent: a scope that quietly widens shows up as
// nothing at all until somebody reads a contract they should not have.

const viewer = (...capabilities: Capability[]): Viewer => ({
  id: "u1",
  roles: [],
  capabilities,
});

const ARCHIVE = viewer("CONTRACT_VIEW", "CONTRACT_MANAGE");
const RENTAL = viewer("RENTAL_VIEW", "RENTAL_MANAGE");
const NOBODY = viewer();

describe("contractScopeOf", () => {
  it("gives the whole archive to CONTRACT_VIEW", () => {
    expect(contractScopeOf(ARCHIVE)).toEqual({ kind: "everything" });
  });

  it("gives rentals only to RENTAL_VIEW", () => {
    expect(contractScopeOf(RENTAL)).toEqual({ kind: "rentalsOnly" });
  });

  it("gives nothing to somebody holding neither", () => {
    expect(contractScopeOf(NOBODY)).toEqual({ kind: "none" });
  });

  it("prefers the wider grant when somebody holds both", () => {
    expect(contractScopeOf(viewer("CONTRACT_VIEW", "RENTAL_VIEW"))).toEqual({ kind: "everything" });
  });
});

describe("contractScopeWhere", () => {
  it("is the empty filter for the whole archive, so it composes", () => {
    expect(contractScopeWhere({ kind: "everything" })).toEqual({});
  });

  it("narrows to rows with a RentalDetails relation", () => {
    expect(contractScopeWhere({ kind: "rentalsOnly" })).toEqual({
      rental: { isNot: null },
    });
  });

  it("matches nothing for an empty scope, rather than everything", () => {
    // The failure mode this guards: a filter that came out `{}` for a viewer
    // with no capability would hand them the archive.
    const where = contractScopeWhere({ kind: "none" });
    expect(where).toEqual({ id: { in: [] } });
    expect(where).not.toEqual({});
  });
});

describe("scopeIncludes", () => {
  it("lets an archive viewer open anything", () => {
    const scope = contractScopeOf(ARCHIVE);
    expect(scopeIncludes(scope, { rental: null })).toBe(true);
    expect(scopeIncludes(scope, { rental: {} })).toBe(true);
  });

  it("lets a rental viewer open a rental and nothing else", () => {
    const scope = contractScopeOf(RENTAL);
    expect(scopeIncludes(scope, { rental: {} })).toBe(true);
    expect(scopeIncludes(scope, { rental: null })).toBe(false);
  });
});

describe("canManageKind", () => {
  it("lets the wide grant change any document", () => {
    expect(canManageKind(ARCHIVE, { hasRental: false })).toBe(true);
    expect(canManageKind(ARCHIVE, { hasRental: true })).toBe(true);
  });

  it("lets the rental grant change a rental only", () => {
    // Not even to fix a typo in a sponsoravtal's title.
    expect(canManageKind(RENTAL, { hasRental: true })).toBe(true);
    expect(canManageKind(RENTAL, { hasRental: false })).toBe(false);
  });

  it("refuses somebody who may only read", () => {
    expect(canManageKind(viewer("RENTAL_VIEW"), { hasRental: true })).toBe(false);
    expect(canManageKind(viewer("CONTRACT_VIEW"), { hasRental: false })).toBe(false);
  });

  it("refuses somebody holding nothing", () => {
    expect(canManageKind(NOBODY, { hasRental: true })).toBe(false);
  });
});
