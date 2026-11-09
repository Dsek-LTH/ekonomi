// What one viewer may see and change of the document archive. Policy lives here: every query
// intersects `contractScopeWhere`, every by-id route asks `scopeIncludes`.
// A rental is a CONTRACT row with a RentalDetails relation, so the scope is three states, not a list of kinds.
import "server-only";

import { Prisma } from "@/lib/generated/prisma/client";
import {
  canManageContracts,
  canManageRentals,
  canViewContracts,
  canViewRentals,
} from "@/lib/domain/permissions";
import type { Capability, Role } from "@/lib/domain/types";

export type Viewer = { id: string; roles: Role[]; capabilities: Capability[] };

export type ContractScope =
  | { kind: "everything" }
  /** Rentals only: CONTRACT rows with a RentalDetails relation attached. */
  | { kind: "rentalsOnly" }
  /** Nothing: a page redirects, a route answers 403, a stray query returns no rows. */
  | { kind: "none" };

export function contractScopeOf(viewer: Viewer): ContractScope {
  if (canViewContracts(viewer.capabilities)) return { kind: "everything" };
  if (canViewRentals(viewer.capabilities)) return { kind: "rentalsOnly" };
  return { kind: "none" };
}

/** The scope as a Prisma filter. Unrestricted is the empty filter; none matches nothing via an impossible condition. */
export function contractScopeWhere(scope: ContractScope): Prisma.ContractWhereInput {
  switch (scope.kind) {
    case "everything":
      return {};
    case "rentalsOnly":
      return { rental: { isNot: null } };
    case "none":
      return { id: { in: [] } };
  }
}

export function scopeIncludes(scope: ContractScope, contract: { rental: unknown | null }): boolean {
  if (scope.kind === "everything") return true;
  if (scope.kind === "rentalsOnly") return contract.rental != null;
  return false;
}

/**
 * Whether the viewer may change this document. Read and write differ: RENTAL_MANAGE can amend an
 * uthyrningsavtal but not touch a sponsoravtal.
 */
export function canManageKind(viewer: Viewer, contract: { hasRental: boolean }): boolean {
  if (canManageContracts(viewer.capabilities)) return true;
  return contract.hasRental && canManageRentals(viewer.capabilities);
}
