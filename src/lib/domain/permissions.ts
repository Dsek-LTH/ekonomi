// Central authority layer. Every gate (nav, pages, API routes) calls these helpers instead of testing roles inline.
// Which roles hold a capability is the RoleCapability table; the set is resolved per request in
// lib/server/capabilities.ts and carried on `user.capabilities` (lib/server/current-user.ts).
import type { Capability, Role } from "@/lib/domain/types";
import { STOCK_SLUGS, STOCKS, type StockSlug } from "@/lib/stock/stocks";

const has = (caps: readonly Capability[], cap: Capability) => caps.includes(cap);

// One name per question: `canUnexport` and `canLogInToFortnox` share roles today but stay separate.

/** Full authority over other people's utlägg. Woven into the attest rule. */
export const isAdmin = (caps: readonly Capability[]) => has(caps, "ADMIN");

/** May work the bookkeeping system: kontera and bokföra vouchers, card feed, income, ledger sync. */
export const canBookkeep = (caps: readonly Capability[]) => has(caps, "BOOKKEEPING");

/** May see what bookkeeping sees without doing any of it (a revisor). Implied by BOOKKEEPING. */
export const canViewBookkeeping = (caps: readonly Capability[]) =>
  has(caps, "BOOKKEEPING_VIEW") || canBookkeep(caps);

/** May review a year's vouchers as a revisor. Separate from canBookkeep so a review is never the reviewed reviewing themselves. */
export const canAuditReview = (caps: readonly Capability[]) => has(caps, "AUDIT_REVIEW");

/** May send a wrongly-approved expense back for changes. */
export const canReturnApproved = canBookkeep;

/** Books in Fortnox under their own login. */
export const canLogInToFortnox = (caps: readonly Capability[]) => has(caps, "FORTNOX_LOGIN");

/** May mark an exported utlägg as no longer exported. Only unwinds OUR record, the voucher stays in Fortnox. */
export const canUnexport = (caps: readonly Capability[]) => has(caps, "EXPORT_UNDO");

/** May bokföra an utlägg they konterade themselves, past the two-person rule (lib/domain/review.ts). */
export const canReviewOwnBooking = (caps: readonly Capability[]) => has(caps, "REVIEW_OWN_BOOKING");

/** May reach Inställningar, so lib/server/capabilities.ts refuses to let the last holder go. */
export const canAccessSettings = (caps: readonly Capability[]) => has(caps, "SETTINGS");

/**
 * May give a member a role or a capability of their own (AccessGrant), oneself included, and take it away.
 * As much as holding everything, since it can grant anything.
 */
export const canGrantAccess = (caps: readonly Capability[]) => has(caps, "GRANT_ACCESS");

/** May open Inställningar → Användare: to look people up, or to give them access. */
export const canSeeUsers = (caps: readonly Capability[]) =>
  canAccessSettings(caps) || canGrantAccess(caps);

// Lagerbokföring is not bookkeeping, so these are their own capabilities.

// Per stock: the people who keep the bar's stock are not the people who keep the café's.

const STOCK_CAPS: Record<StockSlug, { view: Capability; manage: Capability }> = {
  alcohol: { view: "ALCOHOL_STOCK_VIEW", manage: "ALCOHOL_STOCK_MANAGE" },
  cafe: { view: "CAFE_STOCK_VIEW", manage: "CAFE_STOCK_MANAGE" },
};

/**
 * What the stock gates read: capabilities from roles, and the places held through Authentik groups
 * (User.stockPlaceIds). Both a User and an api Actor have this shape.
 */
export interface StockReach {
  capabilities: readonly Capability[];
  stockPlaceIds: readonly string[];
  /** The stocks those places are in. */
  placeStocks: readonly StockSlug[];
}

/** Register movements, run an event, close a stocktake, edit a product. */
export const canManageStock = (caps: readonly Capability[], stock: StockSlug) =>
  has(caps, STOCK_CAPS[stock].manage);

/** Read a stock's overview and its log. Implied by keeping it. */
export const canViewStock = (caps: readonly Capability[], stock: StockSlug) =>
  has(caps, STOCK_CAPS[stock].view) || canManageStock(caps, stock);

/** May open the Flytta page: holds a place in the stock, or keeps it. Which moves are allowed is canMoveBetween. */
export const canMoveStock = (who: StockReach, stock: StockSlug) =>
  STOCKS[stock].usesPlaces &&
  (canManageStock(who.capabilities, stock) || who.placeStocks.includes(stock));

/**
 * May log one move: the keeper anything, anyone else only a move with a place they hold at one end.
 * Storage is `null` and is held by nobody, so a refill is granted by the fridge and a return by where it came from.
 */
export const canMoveBetween = (
  who: StockReach,
  stock: StockSlug,
  from: string | null,
  to: string | null,
) =>
  canManageStock(who.capabilities, stock) ||
  (canMoveStock(who, stock) &&
    [from, to].some((place) => place !== null && who.stockPlaceIds.includes(place)));

/** May open a stock's Bokföring page: its vouchers to Fortnox and the reconciliation. Bookkeeping, not keeping the stock. */
export const canBookStock = (caps: readonly Capability[]) => canViewBookkeeping(caps);

/** May open a stock's pages at all: to read it, to log moves in it, or to book it. Each page then asks for its own. */
export const canEnterStock = (who: StockReach, stock: StockSlug) =>
  canViewStock(who.capabilities, stock) ||
  canMoveStock(who, stock) ||
  canBookStock(who.capabilities);

/** The stocks this person can open, in nav order. */
export const viewableStocks = (caps: readonly Capability[]): StockSlug[] =>
  STOCK_SLUGS.filter((stock) => canViewStock(caps, stock));

/** May log their own withdrawals from the café stock as a board member, and see their own tab. */
export const hasBoardTab = (caps: readonly Capability[]) => has(caps, "BOARD_TAB");

// ── Budget ────────────────────────────────────────────────────────

/** May see the budget pages. Granted to every role by default. */
export const canAccessBudget = (caps: readonly Capability[]) => has(caps, "BUDGET_VIEW");

/** May comment on a budget account. */
export const canCommentBudget = (caps: readonly Capability[]) => has(caps, "BUDGET_COMMENT");

/** May lock a budget, and unlock one. */
export const canLockBudget = (caps: readonly Capability[]) => has(caps, "BUDGET_LOCK");

/** May record a redaktionell ändring (budgetavsteg or budgetförflyttning) on a locked budget. Separate from BUDGET_LOCK. */
export const canChangeLockedBudget = (caps: readonly Capability[]) =>
  has(caps, "BUDGET_CHANGE_LOCKED");

/** May see the attest queue. Whether a given utlägg can be attested is `canAttestAllocation`'s per-row answer. */
export const hasAttestRole = (caps: readonly Capability[]) => has(caps, "ATTEST_VIEW");

// ── Avtal ─────────────────────────────────────────────────────────
// Two capabilities: avtal name non-members and bind the section, so reading the archive is narrower than reading a budget.

/** May read the whole avtal archive, every kind of agreement in it. */
export const canViewContracts = (caps: readonly Capability[]) => has(caps, "CONTRACT_VIEW");

/** May read uthyrningsavtal. Implied by the wider grant above. */
export const canViewRentals = (caps: readonly Capability[]) =>
  has(caps, "RENTAL_VIEW") || canViewContracts(caps);

/** May draw an uthyrningsavtal and keep the gear catalogue. Implied by the wider grant. */
export const canManageRentals = (caps: readonly Capability[]) =>
  has(caps, "RENTAL_MANAGE") || has(caps, "CONTRACT_MANAGE");

/** May archive a contract, draw an uthyrningsavtal, and edit the gear catalogue. Not authority to bind the section (firmateckning, decided outside this app). */
export const canManageContracts = (caps: readonly Capability[]) => has(caps, "CONTRACT_MANAGE");

// ── Reminders ─────────────────────────────────────────────────────

/** May remind whoever an utlägg is waiting on, by mail. See lib/server/reminders.ts. */
export const canSendReminders = (caps: readonly Capability[]) => has(caps, "SEND_REMINDERS");

// ── Redovisningsbetyg ─────────────────────────────────────────────

/** May see every member's redovisningsbetyg (lib/domain/member-score.ts). A member sees their own without it. */
export const canViewMemberScores = (caps: readonly Capability[]) => has(caps, "MEMBER_SCORE_VIEW");

// ── Leverantörsfakturor ───────────────────────────────────────────

/** May keep the levfaktura inkorg: see arrivals, add an invoice by hand, give it to a result unit or take it back, discard non-invoices. Not the attest, which is `canAttestAllocation`'s per row. */
export const canTriageInvoices = (caps: readonly Capability[]) => has(caps, "INVOICE_TRIAGE");

/** May open the levfaktura pages at all. Which invoices are shown is lib/data/supplier-invoices.ts's call. */
export const canSeeInvoices = (caps: readonly Capability[]) =>
  canTriageInvoices(caps) || canViewBookkeeping(caps) || hasAttestRole(caps);

// ── Dispens från redovisningsfristen ──────────────────────────────

/** May let one late eget utlägg past the 60-day filing deadline. Seeded to SKATTMASTARE only. Does not grant the attest, which is still per allocation (`canAttestAllocation`). */
export const canWaiveFilingDeadline = (caps: readonly Capability[]) =>
  has(caps, "EXPENSE_DEADLINE_WAIVE");

// Not a capability: attest depends on actor, submitter and allocation together, so a tickbox would lie.
// ADMIN comes through as a capability (full authority over other people's utlägg, the policy's
// firmatecknare); the resultatansvarig clause is the rule itself. Policy för ekonomi names those two only.

// Whether `actor` may attest (and so also reject / request changes on) one allocation of an expense.
// All inputs are explicit so this stays pure.
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
// Every role, in the order they're listed in the UI.
export const ROLES: readonly Role[] = [
  "SKATTMASTARE",
  "ORDFORANDE",
  "VICE_SKATTMASTARE",
  "SKATTFORMAN",
  "RESULTATANSVARIG",
  "STOCKARE",
  "UTHYRNINGSANSVARIG",
  "CAFE_STOCKARE",
  "STYRELSE",
  "REVISOR",
  "ORDINARIE",
];

// ORDINARIE is the baseline every member holds, so it says nothing about a person. These are the roles worth managing.
export const ASSIGNABLE_ROLES: readonly Role[] = ROLES.filter((r) => r !== "ORDINARIE");

// The roles a personal grant may give. Not RESULTATANSVARIG: it means nothing without result units, and those
// come from groups only.
export const GRANTABLE_ROLES: readonly Role[] = ASSIGNABLE_ROLES.filter(
  (r) => r !== "RESULTATANSVARIG",
);

// Every capability, in the order the Inställningar → Roller grid draws them. A keyed object so the
// compiler requires all of them.
const CAPABILITY_ORDER = {
  ADMIN: 0,
  SETTINGS: 1,
  GRANT_ACCESS: 1.5,
  BOOKKEEPING: 2,
  ATTEST_VIEW: 3,
  BUDGET_VIEW: 4,
  ALCOHOL_STOCK_VIEW: 5,
  ALCOHOL_STOCK_MANAGE: 6,
  CAFE_STOCK_VIEW: 6.1,
  CAFE_STOCK_MANAGE: 6.3,
  BOARD_TAB: 6.4,
  BUDGET_COMMENT: 7,
  BUDGET_LOCK: 8,
  BUDGET_CHANGE_LOCKED: 9,
  CONTRACT_VIEW: 10,
  CONTRACT_MANAGE: 11,
  FORTNOX_LOGIN: 12,
  EXPORT_UNDO: 13,
  EXPENSE_DEADLINE_WAIVE: 14,
  // Last, to avoid renumbering the CONTRACT_* pair it belongs with.
  RENTAL_VIEW: 15,
  RENTAL_MANAGE: 16,
  FIRMATECKNARE: 17,
  SEND_REMINDERS: 18,
  INVOICE_TRIAGE: 19,
  REVIEW_OWN_BOOKING: 20,
  BOOKKEEPING_VIEW: 21,
  AUDIT_REVIEW: 22,
  MEMBER_SCORE_VIEW: 23,
} satisfies Record<Capability, number>;

export const CAPABILITIES: readonly Capability[] = (
  Object.keys(CAPABILITY_ORDER) as Capability[]
).sort((a, b) => CAPABILITY_ORDER[a] - CAPABILITY_ORDER[b]);
