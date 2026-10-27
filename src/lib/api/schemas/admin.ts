// Request bodies for the settings screens and the member's own profile:
// section cards, cost centres, result units and their prefixes, the Fortnox
// connection, and payout details.
import { z } from "zod";
import { Clearable, Id, IsoDate, NonEmpty, Trimmed, UpperCode } from "./common";
import { ALL_KINDS, SWITCHABLE_KINDS } from "@/lib/domain/notifications";
import type { NotificationKind } from "@/lib/domain/types";

/** POST /api/cards: register a section card. */
export const CreateCard = z.object({
  // The last four digits off the card, which is all the bank export gives us.
  last4: Trimmed.regex(/^\d{4}$/),
  holderId: Clearable(Id).optional(),
});
export type CreateCard = z.infer<typeof CreateCard>;

/** PATCH /api/cards/[id]: assign or unassign the holder, the result unit, or both. */
export const PatchCard = z.object({
  holderId: Clearable(Id).optional(),
  resultUnitId: Clearable(Id).optional(),
});
export type PatchCard = z.infer<typeof PatchCard>;

/** POST /api/cost-centers: a LOCAL cost centre, for a dimension Fortnox has none for. */
export const CreateCostCenter = z.object({
  code: UpperCode.pipe(NonEmpty),
  name: NonEmpty,
});
export type CreateCostCenter = z.infer<typeof CreateCostCenter>;

/**
 * PATCH /api/cost-centers/[id].
 *
 * No `code`: allocations and voucher lines point at this row, and the result
 * unit that attests them is derived from the code, so it is not something a
 * rename may quietly change.
 */
export const PatchCostCenter = z.object({
  name: NonEmpty.optional(),
  active: z.boolean().optional(),
});
export type PatchCostCenter = z.infer<typeof PatchCostCenter>;

/** POST /api/result-units, PATCH /api/result-units/[id]. */
export const ResultUnitBody = z.object({
  name: NonEmpty,
});
export type ResultUnitBody = z.infer<typeof ResultUnitBody>;

/** POST /api/result-units/[id]/prefixes. */
export const AddPrefix = z.object({
  value: UpperCode.pipe(NonEmpty),
});
export type AddPrefix = z.infer<typeof AddPrefix>;

/**
 * PATCH /api/profile: the member's own payout details.
 *
 * Both are clearable: somebody who has left the section's payroll should be
 * able to take their account number back out.
 */
export const PatchProfile = z.object({
  bankClearingNumber: Clearable(Trimmed).optional(),
  bankAccountNumber: Clearable(Trimmed).optional(),
});
export type PatchProfile = z.infer<typeof PatchProfile>;

/**
 * PATCH /api/fortnox/settings: the voucher series exports land in, and the two
 * accounts the payment row of every verification is posted against.
 *
 * The accounts are checked against the synced chart by the route; all this says
 * is that they were sent as something that could be one.
 */
export const FortnoxSettings = z.object({
  voucherSeries: UpperCode.pipe(NonEmpty).optional(),
  bankAccount: NonEmpty.optional(),
  memberDebtAccount: NonEmpty.optional(),
});
export type FortnoxSettings = z.infer<typeof FortnoxSettings>;

/**
 * POST /api/fortnox/sync: pull the ledger.
 *
 * `financialYearId` is Fortnox's own id for a financial year, a small integer
 * like 9, not a calendar year. It was called `year` and validated as one, which
 * meant every per-year sync button on the settings screen was refused: the
 * button sends the id it has (FortnoxFinancialYear.id, which is Fortnox's), and
 * 9 is not between 1900 and 2200. The name is the fix as much as the bounds
 * are. `syncLedger` and the CLI's `--year` flag have always meant the id.
 */
export const FortnoxSync = z.object({
  scope: z.enum(["current", "all"]).default("current"),
  financialYearId: z.int().positive().optional(),
});
export type FortnoxSync = z.infer<typeof FortnoxSync>;

/**
 * POST /api/mileage/rates and PATCH /api/mileage/rates/[id]: what a kilometre
 * is worth, from a given day.
 *
 * `orePerKm` rather than kronor per mil, which is how the figure is quoted and
 * how the form asks for it: the conversion is the screen's, so the stored unit
 * is the one every calculation uses and nothing downstream has to remember a
 * factor of ten. Bounded because a slipped decimal here is a slipped decimal on
 * every claim filed after it. 100 kr/km is not a schablon anyone has set.
 */
export const MileageRateInput = z.object({
  orePerKm: z.int().positive().max(10000),
  validFrom: IsoDate,
  note: Clearable(Trimmed).optional(),
});
export type MileageRateInput = z.infer<typeof MileageRateInput>;

// ── Authority (Inställningar → Roller) ────────────────────────────
//
// Roles and capabilities arrive as bare strings and are checked against the
// vocabulary here rather than trusted: these two bodies are the only way into
// the tables every gate in the app reads, so a value the code has no meaning for
// must be refused at the edge rather than stored and puzzled over later.

const RoleName = z.enum([
  "SKATTMASTARE",
  "ORDFORANDE",
  "VICE_SKATTMASTARE",
  "SKATTFORMAN",
  "RESULTATANSVARIG",
  "STOCKARE",
  "UTHYRNINGSANSVARIG",
  "ORDINARIE",
]);

/**
 * The capabilities a settings screen may write.
 *
 * Written out rather than derived from the Prisma enum, because a request body
 * is a contract with a client and should not silently widen when the schema
 * gains a value. The cost is that it can fall behind: a capability drawn in the
 * grid but missing here is a tickbox that fails to save, with nothing on the
 * screen to say why. `admin.test.ts` holds the two lists together.
 */
export const CapabilityName = z.enum([
  "ADMIN",
  "BOOKKEEPING",
  "FORTNOX_LOGIN",
  "EXPORT_UNDO",
  "SETTINGS",
  "STOCK_VIEW",
  "STOCK_MANAGE",
  "BUDGET_VIEW",
  "BUDGET_COMMENT",
  "BUDGET_LOCK",
  "BUDGET_CHANGE_LOCKED",
  "ATTEST_VIEW",
  "CONTRACT_VIEW",
  "CONTRACT_MANAGE",
  "EXPENSE_DEADLINE_WAIVE",
  "FIRMATECKNARE",
  "RENTAL_VIEW",
  "RENTAL_MANAGE",
  "SEND_REMINDERS",
  "INVOICE_TRIAGE",
]);

/**
 * PUT /api/authority/groups: what one Authentik group confers.
 *
 * The whole grant for one group, not a delta: the screen edits a row as a unit,
 * and sending the finished state means two people saving at once cannot
 * interleave into a grant neither of them chose.
 *
 * Lower-cased here because that is the one form everything downstream compares
 * (`normaliseGroup` in lib/server/authentik-roles.ts). A row stored with a
 * capital would simply never match anybody.
 */
export const PutGroupGrant = z.object({
  group: NonEmpty.toLowerCase(),
  roles: z.array(RoleName),
  resultUnitIds: z.array(Id),
});
export type PutGroupGrant = z.infer<typeof PutGroupGrant>;

/** DELETE is by group name, which is the row's identity. */
export const DeleteGroupGrant = z.object({ group: NonEmpty.toLowerCase() });
export type DeleteGroupGrant = z.infer<typeof DeleteGroupGrant>;

/**
 * PUT /api/authority/capabilities: everything one role may do.
 *
 * Again the finished state for one role rather than a tick or an untick. The
 * grid is small enough to send whole, and a lockout check is only meaningful
 * against an outcome.
 */
export const PutRoleCapabilities = z.object({
  role: RoleName,
  capabilities: z.array(CapabilityName),
});
export type PutRoleCapabilities = z.infer<typeof PutRoleCapabilities>;

/**
 * PUT /api/profile/notifications: switch one kind of email on or off for the
 * signed-in member. Only the kinds a member may switch; the weekly digest is
 * not among them.
 */
export const PutNotificationPreference = z.object({
  kind: z.enum(SWITCHABLE_KINDS as [NotificationKind, ...NotificationKind[]]),
  enabled: z.boolean(),
});
export type PutNotificationPreference = z.infer<typeof PutNotificationPreference>;

/**
 * POST /api/users/[id]/test-email: send one member a test mail of any kind,
 * the digest included.
 */
export const SendTestEmail = z.object({
  kind: z.enum(ALL_KINDS as [NotificationKind, ...NotificationKind[]]),
});
export type SendTestEmail = z.infer<typeof SendTestEmail>;
