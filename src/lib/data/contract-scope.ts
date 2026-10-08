// What one viewer may see of the document archive, and what they may change.
//
// Shaped after lib/data/expense-scope.ts, which does the same job for utlägg,
// and for the same reason: a scope written at each call site is a scope that
// will be forgotten at one of them. The policy lives here, every query
// intersects with `contractScopeWhere`, and every route that reaches one
// contract by id asks `scopeIncludes`.
//
// The case that makes this necessary is the uthyrningsansvarig. They need to
// find last spring's rental, and they have no business reading what the section
// pays a sponsor. Before this, CONTRACT_VIEW was all or nothing and they had
// the lot.
//
// A rental is no longer its own `kind` (see prisma/schema/contract.prisma):
// it is a CONTRACT row with a RentalDetails relation attached, the same as
// every other agreement. So "rentals only" can no longer be expressed as a
// list of kinds, which is why this scope is a plain three-state answer
// rather than `{ kinds: ContractKind[] }`.
import "server-only";

import { Prisma } from "@/lib/generated/prisma/client";
import {
  canManageContracts,
  canManageRentals,
  canViewContracts,
  canViewRentals,
} from "@/lib/domain/permissions";
import type { Capability, Role } from "@/lib/domain/types";

/** Who is asking. Both a page's session user and an API `Actor` fit this. */
export type Viewer = { id: string; roles: Role[]; capabilities: Capability[] };

/** What one viewer may reach. */
export type ContractScope =
  /** The whole archive, every kind. */
  | { kind: "everything" }
  /** Rentals only: CONTRACT rows with a RentalDetails relation attached. */
  | { kind: "rentalsOnly" }
  /** Nothing at all. What a viewer with neither capability gets: a page
   *  redirects them and a route answers 403, and any query that reaches
   *  here anyway returns no rows rather than all of them. */
  | { kind: "none" };

/** Resolve `viewer` to their scope. The only place this policy lives. */
export function contractScopeOf(viewer: Viewer): ContractScope {
  if (canViewContracts(viewer.capabilities)) return { kind: "everything" };
  if (canViewRentals(viewer.capabilities)) return { kind: "rentalsOnly" };
  return { kind: "none" };
}

/**
 * The scope as a Prisma filter.
 *
 * An unrestricted scope is the empty filter, so it composes into any `where`
 * without a special case at the call site. An empty scope matches nothing, and
 * says so with an impossible condition rather than by being forgotten: a query
 * that reached here with no capability returns no rows rather than all of them.
 */
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

/** Whether one already-fetched contract falls inside the scope. */
export function scopeIncludes(
  scope: ContractScope,
  contract: { rental: unknown | null },
): boolean {
  if (scope.kind === "everything") return true;
  if (scope.kind === "rentalsOnly") return contract.rental != null;
  return false;
}

/**
 * Whether the viewer may change this document.
 *
 * Read and write are asked separately because they are not the same question,
 * and the rental case is where that shows: RENTAL_MANAGE can draw and amend an
 * uthyrningsavtal, and cannot touch a sponsoravtal even to fix a typo in its
 * title.
 *
 * Takes whether the row is a rental rather than the row itself, so the caller
 * decides how cheaply that's answered (a `select: { rental: { select: {
 * contractId: true } } }` alongside whatever else it already fetches).
 */
export function canManageKind(viewer: Viewer, contract: { hasRental: boolean }): boolean {
  if (canManageContracts(viewer.capabilities)) return true;
  return contract.hasRental && canManageRentals(viewer.capabilities);
}
