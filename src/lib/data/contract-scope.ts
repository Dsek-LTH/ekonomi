// What one viewer may see of the avtal archive, and what they may change.
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
import "server-only";

import { Prisma } from "@/lib/generated/prisma/client";
import {
  canManageContracts,
  canManageRentals,
  canViewContracts,
  canViewRentals,
} from "@/lib/domain/permissions";
import type { Capability, ContractKind, Role } from "@/lib/domain/types";

/** Who is asking. Both a page's session user and an API `Actor` fit this. */
export type Viewer = { id: string; roles: Role[]; capabilities: Capability[] };

/**
 * What one viewer may reach.
 *
 * Two answers rather than a list of kinds, because there are only two, and a
 * list would invite call sites to intersect it themselves. If the section ever
 * wants "sponsring only" for näringslivsutskottet, this becomes
 * `{ kinds: ContractKind[] }` and every `where` below keeps working.
 */
export type ContractScope =
  /** The whole archive, every kind. */
  | { everything: true }
  /**
   * Only these kinds. An empty list is a real value and means nothing at all,
   * which is what a viewer with neither capability gets: a page redirects them
   * and a route answers 403, and any query that reaches here anyway returns no
   * rows rather than all of them.
   */
  | { everything: false; kinds: ContractKind[] };

/** Resolve `viewer` to their scope. The only place this policy lives. */
export function contractScopeOf(viewer: Viewer): ContractScope {
  if (canViewContracts(viewer.capabilities)) return { everything: true };
  if (canViewRentals(viewer.capabilities)) return { everything: false, kinds: ["RENTAL"] };
  return { everything: false, kinds: [] };
}

/** Whether the viewer may see anything at all. What a page gate asks. */
export const scopeIsEmpty = (scope: ContractScope): boolean =>
  !scope.everything && scope.kinds.length === 0;

/**
 * The scope as a Prisma filter.
 *
 * An unrestricted scope is the empty filter, so it composes into any `where`
 * without a special case at the call site. An empty scope matches nothing, and
 * says so with an impossible condition rather than by being forgotten: a query
 * that reached here with no capability returns no rows rather than all of them.
 */
export function contractScopeWhere(scope: ContractScope): Prisma.ContractWhereInput {
  if (scope.everything) return {};
  if (scope.kinds.length === 0) return { id: { in: [] } };
  return { kind: { in: scope.kinds } };
}

/** Whether one already-fetched contract falls inside the scope. */
export function scopeIncludes(scope: ContractScope, contract: { kind: ContractKind }): boolean {
  if (scope.everything) return true;
  return scope.kinds.includes(contract.kind);
}

/**
 * Whether the viewer may change this contract.
 *
 * Read and write are asked separately because they are not the same question,
 * and the rental case is where that shows: RENTAL_MANAGE can draw and amend an
 * uthyrningsavtal, and cannot touch a sponsoravtal even to fix a typo in its
 * title.
 *
 * Takes the kind rather than the row, so a route can ask before fetching one,
 * and so a *new* contract can be asked about, where there is no row yet.
 */
export function canManageKind(viewer: Viewer, kind: ContractKind): boolean {
  if (canManageContracts(viewer.capabilities)) return true;
  return kind === "RENTAL" && canManageRentals(viewer.capabilities);
}
