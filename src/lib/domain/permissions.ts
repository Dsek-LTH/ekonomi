// Central authority layer. Every gate in the app (nav, pages, API routes)
// should call these helpers rather than testing roles or capabilities inline,
// so the policy lives in one place.
//
// What a helper reads changed when authority became editable. It used to be a
// role list per question, written here:
//
//     const BOOKKEEPING_ROLES = ["SKATTMASTARE", "ORDFORANDE", ...];
//     canAccessBookkeeping = (roles) => hasAny(roles, BOOKKEEPING_ROLES);
//
// Now the same question is one capability, and which roles hold it is a table
// the treasurer edits (Inställningar → Roller, RoleCapability). So a helper is
// a lookup, and this file's job is no longer to decide who may do what. It is
// to name the things that can be done, exactly once each, so that a call site
// and a tickbox are talking about the same thing.
//
// The capability set is resolved per request in lib/server/capabilities.ts and
// carried on the acting user (`user.capabilities`), the same way `roles` always
// was. Nothing is read from the session token; see lib/server/current-user.ts.
import type { Capability, Role } from "@/lib/domain/types";

const has = (caps: readonly Capability[], cap: Capability) => caps.includes(cap);

// ── Access capabilities ───────────────────────────────────────────
//
// One line each, and deliberately still one *name* each. `canUnexport` and
// `canLogInToFortnox` happen to be granted to the same roles today and are two
// questions all the same. The first of them to be given to somebody new should
// not have to be untangled from the other at that point.

/** Full authority over other people's utlägg. Woven into the attest rule. */
export const isAdmin = (caps: readonly Capability[]) => has(caps, "ADMIN");

/** May reach the bookkeeping system (bookkeeping page, bank & matching). */
export const canAccessBookkeeping = (caps: readonly Capability[]) => has(caps, "BOOKKEEPING");

/** May create/amend vouchers. */
export const canBookkeep = canAccessBookkeeping;

/** May send a wrongly-approved expense back for changes. */
export const canReturnApproved = canAccessBookkeeping;

/** Books in Fortnox under their own login. Drives the Fortnox status on
 *  /profile. */
export const canLogInToFortnox = (caps: readonly Capability[]) => has(caps, "FORTNOX_LOGIN");

/** May mark an exported utlägg as no longer exported. Undoing an export only
 *  unwinds OUR record. The voucher stays in Fortnox, so it belongs to the
 *  people who can go clean that up. */
export const canUnexport = (caps: readonly Capability[]) => has(caps, "EXPORT_UNDO");

/** May reach Inställningar, and therefore edit authority itself, which is why
 *  lib/server/capabilities.ts refuses to let the last holder go. */
export const canAccessSettings = (caps: readonly Capability[]) => has(caps, "SETTINGS");

// ── Alkohollager ──────────────────────────────────────────────────
//
// Keeping the lagerbokföring is not bookkeeping, and the people who do it are
// not the people who book vouchers, so these are their own capabilities rather
// than a corner of BOOKKEEPING.

/** Read the stock overview and the log. */
export const canViewStock = (caps: readonly Capability[]) => has(caps, "STOCK_VIEW");

/** Register movements, run an event, close a stocktake, edit a product's
 *  calibration. */
export const canManageStock = (caps: readonly Capability[]) => has(caps, "STOCK_MANAGE");

// ── Budget ────────────────────────────────────────────────────────

/** May see the budget pages. Granted to every role by default. The budget is
 *  the section's, not the treasury's, but it is a row now, so it can be
 *  narrowed without a deploy. */
export const canAccessBudget = (caps: readonly Capability[]) => has(caps, "BUDGET_VIEW");

/** May comment on a budget account. */
export const canCommentBudget = (caps: readonly Capability[]) => has(caps, "BUDGET_COMMENT");

/** May lock a budget, and unlock one. Sealing the adopted figures is a narrower
 *  thing than editing them. */
export const canLockBudget = (caps: readonly Capability[]) => has(caps, "BUDGET_LOCK");

/** May record a redaktionell ändring: ett budgetavsteg eller en
 *  budgetförflyttning, on a locked budget. Whoever seals the adopted figures
 *  is who may depart from them, which is why this is its own capability and not
 *  a corner of BUDGET_LOCK. */
export const canChangeLockedBudget = (caps: readonly Capability[]) =>
  has(caps, "BUDGET_CHANGE_LOCKED");

/** May see the attest queue. Whether any single utlägg in it can actually be
 *  attested is `canAttestAllocation`'s answer, per row. This only decides
 *  whether the view exists. */
export const hasAttestRole = (caps: readonly Capability[]) => has(caps, "ATTEST_VIEW");

// ── Avtal ─────────────────────────────────────────────────────────
//
// Two capabilities rather than one, and the split is not the usual read/write
// pair. An avtal names people who are not members and terms the section is
// bound by, so who may *read* the archive is a narrower question than who may
// read a budget, and it is worth being able to answer it separately from who
// may put things in.

/** May read the whole avtal archive, every kind of agreement in it. */
export const canViewContracts = (caps: readonly Capability[]) => has(caps, "CONTRACT_VIEW");

/** May read uthyrningsavtal. Implied by the wider grant above: somebody who
 *  may read the archive may obviously read the rentals in it. */
export const canViewRentals = (caps: readonly Capability[]) =>
  has(caps, "RENTAL_VIEW") || canViewContracts(caps);

/** May draw an uthyrningsavtal and keep the gear catalogue. Implied by the
 *  wider grant, for the same reason. */
export const canManageRentals = (caps: readonly Capability[]) =>
  has(caps, "RENTAL_MANAGE") || has(caps, "CONTRACT_MANAGE");

/** May archive a contract, draw an uthyrningsavtal, and edit the gear
 *  catalogue.
 *
 *  Not a claim that the holder may bind the section. That is firmateckning, and
 *  it is decided outside this app: the signed document shows who signed and in what
 *  capacity, rather than this app ruling on it. */
export const canManageContracts = (caps: readonly Capability[]) =>
  has(caps, "CONTRACT_MANAGE");

// ── Dispens från redovisningsfristen ──────────────────────────────

/**
 * May let one late eget utlägg past the 60-day filing deadline.
 *
 * A capability rather than a hard-coded role, even though the section means the
 * skattmästare by it. The question is about the person alone, which is what
 * makes a row the right shape for it, and the seeded row grants it to
 * SKATTMASTARE and nobody else. Moving it is possible in Inställningar, and the
 * only role that can reach Inställningar is that same one, so "the
 * skattmästare's alone" holds either way.
 *
 * Sits beside canLockBudget and canChangeLockedBudget on purpose: all three are
 * the treasurer departing from, or sealing, a rule the section set for itself.
 *
 * What it does NOT grant is the attest. A dispens says a late claim may be
 * filed at all; whether the section pays it is still signed for per allocation
 * by whoever answers for the cost centre. See canAttestAllocation.
 */
export const canWaiveFilingDeadline = (caps: readonly Capability[]) =>
  has(caps, "EXPENSE_DEADLINE_WAIVE");

// ── Attest authority ──────────────────────────────────────────────
//
// The part that is not a capability and cannot become one.
//
// Everything above answers "may this person do this kind of thing", which is a
// property of the person alone and so can be a row. Attest is not that: it is a
// question about an actor, a submitter and one allocation, and the answer moves
// with all three. A tickbox saying ORDINARIE may attest would be a tickbox that
// lies, because the rule below would still say no.
//
// So the roles named here are named in code, on purpose. ADMIN comes through as
// a capability because "full authority over other people's utlägg" genuinely is
// one (the policy's firmatecknare); the resultatansvarig clause is the rule
// itself. Policy för ekonomi names those two and nobody else. The vice
// skattmästare used to attest ordinary members' expenses too, until the policy
// was changed to take that away.

// Whether `actor` may attest (and thereby also reject / request changes on) one
// allocation of an expense. All inputs are explicit so this stays a pure
// function. Callers gather ownerships / submitter roles from the DB.
export function canAttestAllocation(args: {
  actorCapabilities: readonly Capability[];
  actorRoles: readonly Role[];
  actorIsSubmitter: boolean;
  actorOwnedResultUnits: readonly string[];
  allocationResultUnit: string | null;
}): boolean {
  const {
    actorCapabilities,
    actorRoles,
    actorIsSubmitter,
    actorOwnedResultUnits,
    allocationResultUnit,
  } = args;

  if (actorIsSubmitter) return false; // never your own expense
  if (isAdmin(actorCapabilities)) return true; // full authority: any expense
  if (
    actorRoles.includes("RESULTATANSVARIG") &&
    allocationResultUnit !== null &&
    actorOwnedResultUnits.includes(allocationResultUnit)
  ) {
    return true; // resultatansvarig: allocations for a result unit they answer for
  }
  return false;
}

// ── Vocabulary ────────────────────────────────────────────────────
// Every role, in the order they're listed in the UI. The display names are
// translations: `common.role.<ROLE>` in messages/*.json.
export const ROLES: readonly Role[] = [
  "SKATTMASTARE",
  "ORDFORANDE",
  "VICE_SKATTMASTARE",
  "SKATTFORMAN",
  "RESULTATANSVARIG",
  "STOCKARE",
  "UTHYRNINGSANSVARIG",
  "ORDINARIE",
];

// ORDINARIE is the baseline every member holds (User.roles defaults to it), so
// it says nothing about a person. These are the roles worth managing. The
// settings view lists holders per role rather than listing every member.
export const ASSIGNABLE_ROLES: readonly Role[] = ROLES.filter((r) => r !== "ORDINARIE");

// Every capability, in the order the grid in Inställningar → Roller draws them:
// the ones that open a whole section of the app first, the finer grants after.
// Names are translations: `common.capability.<CAP>` in messages/*.json.
//
// Written as a keyed object rather than a list so the compiler requires all of
// them. A capability added to the union and forgotten here would be one the grid
// never draws, a permission nobody could ever grant, and nothing would say so.
const CAPABILITY_ORDER = {
  ADMIN: 0,
  SETTINGS: 1,
  BOOKKEEPING: 2,
  ATTEST_VIEW: 3,
  BUDGET_VIEW: 4,
  STOCK_VIEW: 5,
  STOCK_MANAGE: 6,
  BUDGET_COMMENT: 7,
  BUDGET_LOCK: 8,
  BUDGET_CHANGE_LOCKED: 9,
  CONTRACT_VIEW: 10,
  CONTRACT_MANAGE: 11,
  FORTNOX_LOGIN: 12,
  EXPORT_UNDO: 13,
  EXPENSE_DEADLINE_WAIVE: 14,
  // Last, and not beside the CONTRACT_* pair it belongs with, because slotting
  // it there would renumber four capabilities another change is in the middle
  // of touching. Worth moving next to them once that has settled.
  RENTAL_VIEW: 15,
  RENTAL_MANAGE: 16,
  FIRMATECKNARE: 17,
} satisfies Record<Capability, number>;

export const CAPABILITIES: readonly Capability[] = (
  Object.keys(CAPABILITY_ORDER) as Capability[]
).sort((a, b) => CAPABILITY_ORDER[a] - CAPABILITY_ORDER[b]);
