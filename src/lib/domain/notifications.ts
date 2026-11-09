// Which emails a member gets. Defaults: an email is on if it asks the reader to act or is about their own
// money stuck somewhere; everything else is news and opt-in (a mail per attested cost centre gets the mailbox
// ignored). The weekly digest is outside the rule: it cannot be switched off, and is not sent with no sections.
// Pure: lib/server/notify.ts applies it.
import type { NotificationKind } from "./types";

/** On unless switched off. */
const DEFAULT_ON: readonly NotificationKind[] = [
  "EXPENSE_SUBMITTED",
  "EXPENSE_CHANGES_REQUESTED",
  "EXPENSE_DEADLINE_WAIVER_REVOKED",
  "CARD_TRANSACTIONS_IMPORTED",
  "SUPPLIER_INVOICE_ASSIGNED",
  "SUPPLIER_INVOICE_SUBMITTED",
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

/** Every kind a member can switch, in profile order: defaults first, then opt-ins. WEEKLY_DIGEST is absent so it cannot be switched off. */
export const SWITCHABLE_KINDS: readonly NotificationKind[] = [...DEFAULT_ON, ...OPT_IN];

/** Every kind there is, the digest last. What a test mail can be sent as. */
export const ALL_KINDS: readonly NotificationKind[] = [...SWITCHABLE_KINDS, "WEEKLY_DIGEST"];

const isSwitchable = (kind: NotificationKind): boolean => SWITCHABLE_KINDS.includes(kind);

export const isOnByDefault = (kind: NotificationKind): boolean =>
  kind === "WEEKLY_DIGEST" || DEFAULT_ON.includes(kind);

/** Whether a member gets this kind. A saved choice for a kind that cannot be switched is ignored, so an old row cannot silence the digest. */
export function wants(
  kind: NotificationKind,
  saved: ReadonlyMap<NotificationKind, boolean>,
): boolean {
  if (!isSwitchable(kind)) return true;
  return saved.get(kind) ?? isOnByDefault(kind);
}

/** Some kinds only reach people who hold the authority they are about. Which kinds need which is the caller's to say. */
export type NotificationAudience = "everyone" | "attesters" | "bookkeepers" | "cardHolders";

export const AUDIENCE: Record<NotificationKind, NotificationAudience> = {
  EXPENSE_SUBMITTED: "attesters",
  EXPENSE_RECALLED: "attesters",
  EXPENSE_READY_TO_BOOK: "bookkeepers",
  EXPENSE_EXPORT_REVERTED: "bookkeepers",
  CARD_TRANSACTIONS_IMPORTED: "cardHolders",
  // A resultatansvarig holds the attest view, the nearest thing a profile knows to "answers for a unit".
  SUPPLIER_INVOICE_ASSIGNED: "attesters",
  SUPPLIER_INVOICE_SUBMITTED: "attesters",
  EXPENSE_CHANGES_REQUESTED: "everyone",
  EXPENSE_DEADLINE_WAIVER_REVOKED: "everyone",
  EXPENSE_COST_CENTER_APPROVED: "everyone",
  EXPENSE_APPROVED: "everyone",
  EXPENSE_ATTEST_WITHDRAWN: "everyone",
  EXPENSE_DEADLINE_WAIVED: "everyone",
  EXPENSE_EXPORTED: "everyone",
  EXPENSE_REMINDER: "everyone",
  WEEKLY_DIGEST: "everyone",
};
