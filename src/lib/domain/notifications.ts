// Which emails a member gets.
//
// One rule decides the defaults: an email is on unless somebody turns it off
// if it asks the reader to do something, or it is about their own money stuck
// somewhere. Everything else is news, and news is opt-in, because a mailbox
// that gets a message per attested cost centre is a mailbox that stops being
// read, and then the mails that do ask for something are lost with the rest.
//
// The weekly digest is outside the rule. It is the one mail that cannot be
// switched off, and it earns that by staying silent: a section with nothing
// in it is left out, and a digest with no sections is not sent.
//
// Pure, like the rest of domain/: no database. lib/server/notify.ts applies it.
import type { NotificationKind } from "./types";

/** On unless switched off. */
const DEFAULT_ON: readonly NotificationKind[] = [
  "EXPENSE_SUBMITTED",
  "EXPENSE_CHANGES_REQUESTED",
  "EXPENSE_DEADLINE_WAIVER_REVOKED",
  "CARD_TRANSACTIONS_IMPORTED",
];

/** Off unless switched on. */
const OPT_IN: readonly NotificationKind[] = [
  "EXPENSE_COST_CENTER_APPROVED",
  "EXPENSE_APPROVED",
  "EXPENSE_ATTEST_WITHDRAWN",
  "EXPENSE_DEADLINE_WAIVED",
  "EXPENSE_EXPORTED",
  "EXPENSE_RECALLED",
  "EXPENSE_READY_TO_BOOK",
  "EXPENSE_EXPORT_REVERTED",
];

/**
 * Every kind a member can switch, in the order the profile lists them: the
 * defaults first, then the opt-ins. WEEKLY_DIGEST is not here, which is what
 * makes it impossible to switch off rather than merely hidden.
 */
export const SWITCHABLE_KINDS: readonly NotificationKind[] = [...DEFAULT_ON, ...OPT_IN];

export const isSwitchable = (kind: NotificationKind): boolean =>
  SWITCHABLE_KINDS.includes(kind);

export const isOnByDefault = (kind: NotificationKind): boolean =>
  kind === "WEEKLY_DIGEST" || DEFAULT_ON.includes(kind);

/**
 * Whether a member gets this kind, given the choices they have saved. A saved
 * choice for a kind that cannot be switched is ignored rather than honoured,
 * so a row written by an older build cannot silence the digest.
 */
export function wants(
  kind: NotificationKind,
  saved: ReadonlyMap<NotificationKind, boolean>,
): boolean {
  if (!isSwitchable(kind)) return true;
  return saved.get(kind) ?? isOnByDefault(kind);
}

/**
 * Some kinds only reach people who hold the authority they are about. Offering
 * a bookkeeper's mail to a member who cannot book would be a switch that does
 * nothing. Which kinds need which is the caller's to say; this names them.
 */
export type NotificationAudience = "everyone" | "attesters" | "bookkeepers" | "cardHolders";

export const AUDIENCE: Record<NotificationKind, NotificationAudience> = {
  EXPENSE_SUBMITTED: "attesters",
  EXPENSE_RECALLED: "attesters",
  EXPENSE_READY_TO_BOOK: "bookkeepers",
  EXPENSE_EXPORT_REVERTED: "bookkeepers",
  CARD_TRANSACTIONS_IMPORTED: "cardHolders",
  EXPENSE_CHANGES_REQUESTED: "everyone",
  EXPENSE_DEADLINE_WAIVER_REVOKED: "everyone",
  EXPENSE_COST_CENTER_APPROVED: "everyone",
  EXPENSE_APPROVED: "everyone",
  EXPENSE_ATTEST_WITHDRAWN: "everyone",
  EXPENSE_DEADLINE_WAIVED: "everyone",
  EXPENSE_EXPORTED: "everyone",
  WEEKLY_DIGEST: "everyone",
};
