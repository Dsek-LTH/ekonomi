// Central authority layer. Access and attest rights are derived from a user's
// set of roles (plus, for attest, the result unit an expense's cost centre belongs
// to). Every gate in the app — nav, pages, API routes — should call these
// helpers rather than testing roles inline, so the policy lives in one place.
import type { Role } from "@/lib/domain/types";

// ── Role groupings ────────────────────────────────────────────────
const ADMIN_ROLES: readonly Role[] = ["SKATTMASTARE", "ORDFORANDE"];

// Roles with bookkeeping-system access (see all expenses, book, return
// wrongly-approved). Admins are included implicitly.
const BOOKKEEPING_ROLES: readonly Role[] = [
  "SKATTMASTARE",
  "ORDFORANDE",
  "VICE_SKATTMASTARE",
  "SKATTFORMAN",
];

// The treasury proper — the people who actually work inside Fortnox. Narrower
// than BOOKKEEPING_ROLES on purpose: the chair has bookkeeping access in this
// app but no Fortnox login and no business unwinding an export.
const TREASURY_ROLES: readonly Role[] = [
  "SKATTMASTARE",
  "VICE_SKATTMASTARE",
  "SKATTFORMAN",
];

// Roles that, when held by an expense's submitter, make it NOT "ordinarie".
// Exported because the attest *query* (lib/data/attest-scope.ts) has to ask the
// same question of the database that `isOrdinarie` below asks of a loaded row.
export const ELEVATED_SUBMITTER_ROLES: readonly Role[] = [
  "SKATTMASTARE",
  "ORDFORANDE",
  "RESULTATANSVARIG",
];

const hasAny = (roles: readonly Role[], wanted: readonly Role[]) => roles.some((r) => wanted.includes(r));

// ── Access capabilities ───────────────────────────────────────────
export const isAdmin = (roles: readonly Role[]) => hasAny(roles, ADMIN_ROLES);

/** May reach the bookkeeping system (bookkeeping page, bank & matching). */
export const canAccessBookkeeping = (roles: readonly Role[]) => hasAny(roles, BOOKKEEPING_ROLES);

/** May create/amend vouchers. */
export const canBookkeep = canAccessBookkeeping;

/** May send a wrongly-approved expense back for changes. */
export const canReturnApproved = canAccessBookkeeping;

/** Books in Fortnox under their own login — drives the Fortnox status on
 *  /profile. */
export const canLogInToFortnox = (roles: readonly Role[]) => hasAny(roles, TREASURY_ROLES);

// ── Alkohollager ──────────────────────────────────────────────────
//
// Keeping the lagerbokföring is not bookkeeping, and the people who do it are
// not the people who book vouchers — so this hangs off its own role rather
// than off BOOKKEEPING_ROLES. Admins are included because they are included
// everywhere, and because somebody has to be able to fix it at 2am.
const STOCK_ROLES: readonly Role[] = ["STOCKARE", ...ADMIN_ROLES];

/** Read the stock overview and the log. */
export const canViewStock = (roles: readonly Role[]) => hasAny(roles, STOCK_ROLES);

/**
 * Register movements, run an event, close a stocktake, edit a product's
 * calibration.
 *
 * The same set as `canViewStock` today, and separate anyway: the two answer
 * different questions, and the first one to widen — a board that may read the
 * stock without touching it — should not have to be untangled from the other
 * at that point.
 */
export const canManageStock = (roles: readonly Role[]) => hasAny(roles, STOCK_ROLES);

/** May mark an exported utlägg as no longer exported. Undoing an export only
 *  unwinds OUR record — the voucher stays in Fortnox — so it is limited to the
 *  people who can go clean that up. */
export const canUnexport = (roles: readonly Role[]) => hasAny(roles, TREASURY_ROLES);

/** May reach Inställningar. Deliberately not `isAdmin`: the chair counts as an
 *  admin for expense authority but has no business in the settings. */
export const canAccessSettings = (roles: readonly Role[]) => roles.includes("SKATTMASTARE");

/** May comment on a budget account (admins plus the resultatansvariga). */
export const canCommentBudget = (roles: readonly Role[]) => isAdmin(roles) || roles.includes("RESULTATANSVARIG");

/** Everyone signed in can view the budget. */
export const canAccessBudget = () => true;

/** May lock a budget, and unlock one. Narrower than `isAdmin` on
 *  purpose: sealing the adopted figures is the treasurer's call alone — the
 *  chair edits budgets like any other admin but does not get to freeze them. */
export const canLockBudget = (roles: readonly Role[]) => roles.includes("SKATTMASTARE");

/** May record a redaktionell ändring — ett budgetavsteg eller en
 *  budgetförflyttning — on a locked budget. The same reasoning as the lock, and
 *  deliberately the same narrow set: the treasurer seals the adopted figures, so
 *  the treasurer is who may depart from them. Not `isAdmin` — the chair does not
 *  get to move money after the budget is voted through. */
export const canChangeLockedBudget = (roles: readonly Role[]) => roles.includes("SKATTMASTARE");

// Roles that can ever attest something (admins, vice, resultatansvariga). Drives
// visibility of the approvals view; the per-expense check is canAttestAllocation.
const ATTEST_ROLES: readonly Role[] = [
  "SKATTMASTARE",
  "ORDFORANDE",
  "VICE_SKATTMASTARE",
  "RESULTATANSVARIG",
];
export const hasAttestRole = (roles: readonly Role[]) => hasAny(roles, ATTEST_ROLES);

// ── Attest authority ──────────────────────────────────────────────

// A submitter is "ordinarie" when they hold none of the elevated roles.
const isOrdinarie = (submitterRoles: readonly Role[]) =>
  !hasAny(submitterRoles, ELEVATED_SUBMITTER_ROLES);

// Whether `actor` may attest (and thereby also reject / request changes on) one
// allocation of an expense. All inputs are explicit so this stays a pure
// function — callers gather ownerships / submitter roles from the DB.
export function canAttestAllocation(args: {
  actorRoles: readonly Role[];
  actorIsSubmitter: boolean;
  actorOwnedResultUnits: readonly string[];
  submitterRoles: readonly Role[];
  allocationResultUnit: string | null;
}): boolean {
  const {
    actorRoles,
    actorIsSubmitter,
    actorOwnedResultUnits,
    submitterRoles,
    allocationResultUnit,
  } = args;

  if (actorIsSubmitter) return false; // never your own expense
  if (isAdmin(actorRoles)) return true; // skattmästare / ordförande: any expense
  if (actorRoles.includes("VICE_SKATTMASTARE") && isOrdinarie(submitterRoles)) {
    return true; // vice: expenses by ordinarie submitters
  }
  if (
    actorRoles.includes("RESULTATANSVARIG") &&
    allocationResultUnit !== null &&
    actorOwnedResultUnits.includes(allocationResultUnit)
  ) {
    return true; // resultatansvarig: allocations for a result unit they answer for
  }
  return false;
}

// ── Roles ─────────────────────────────────────────────────────────
// Every role, in the order they're listed in the UI. The display names are
// translations — `common.role.<ROLE>` in messages/*.json.
export const ROLES: readonly Role[] = [
  "SKATTMASTARE",
  "ORDFORANDE",
  "VICE_SKATTMASTARE",
  "SKATTFORMAN",
  "RESULTATANSVARIG",
  "STOCKARE",
  "ORDINARIE",
];

// ORDINARIE is the baseline every member holds (User.roles defaults to it), so
// it says nothing about a person. These are the roles worth managing — the
// settings view lists holders per role rather than listing every member.
export const ASSIGNABLE_ROLES: readonly Role[] = ROLES.filter((r) => r !== "ORDINARIE");
