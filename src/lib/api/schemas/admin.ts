// Request bodies for the settings screens and the member's own profile.
import { z } from "zod";
import { Clearable, Id, IsoDate, NonEmpty, Trimmed, UpperCode } from "./common";
import { ALL_KINDS, SWITCHABLE_KINDS } from "@/lib/domain/notifications";
import { GUIDE_STEP_IDS } from "@/lib/domain/guides";
import { SHORT_NAME_MAX } from "@/lib/domain/cost-center-short-name";
import { GRANTABLE_ROLES, ROLES } from "@/lib/domain/permissions";
import type { NotificationKind, Role } from "@/lib/domain/types";

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

/** PATCH /api/cost-centers/[id]. No `code`: allocations point at this row and the attesting result unit is derived from the code. */
export const PatchCostCenter = z.object({
  name: NonEmpty.optional(),
  active: z.boolean().optional(),
});
export type PatchCostCenter = z.infer<typeof PatchCostCenter>;

/**
 * PUT /api/cost-centers/short-names: short names of one or more cost centres, Fortnox ones included (the sync never
 * writes them). Blank clears one back to the full name.
 */
export const PutCostCenterShortNames = z.object({
  names: z
    .array(
      z.object({
        id: Id,
        shortName: Trimmed.max(SHORT_NAME_MAX)
          .nullable()
          .transform((v) => v || null),
      }),
    )
    .min(1)
    .max(1000),
});
export type PutCostCenterShortNames = z.infer<typeof PutCostCenterShortNames>;

/** POST /api/result-units, PATCH /api/result-units/[id]. */
export const ResultUnitBody = z.object({
  name: NonEmpty,
});
export type ResultUnitBody = z.infer<typeof ResultUnitBody>;

/**
 * PUT /api/result-units/[id]/groups: the Authentik groups whose holders answer for the unit (resultatansvariga). The
 * whole set, not a delta. Lower-cased, as everything compares groups.
 */
export const PutResultUnitGroups = z.object({
  groups: z.array(NonEmpty.toLowerCase()).max(50),
});
export type PutResultUnitGroups = z.infer<typeof PutResultUnitGroups>;

/** POST /api/result-units/[id]/prefixes. */
export const AddPrefix = z.object({
  value: UpperCode.pipe(NonEmpty),
});
export type AddPrefix = z.infer<typeof AddPrefix>;

/** PATCH /api/profile: the member's own payout details. Both are clearable. */
export const PatchProfile = z.object({
  bankClearingNumber: Clearable(Trimmed).optional(),
  bankAccountNumber: Clearable(Trimmed).optional(),
});
export type PatchProfile = z.infer<typeof PatchProfile>;

/**
 * PATCH /api/expense-settings: the series utlägg are exported into, and the two accounts the payment row is posted
 * against (the route checks them against the synced chart). The series may be cleared: setup goes in steps.
 */
export const ExpenseSettings = z.object({
  expenseVoucherSeries: Clearable(UpperCode).optional(),
  bankAccount: NonEmpty.optional(),
  memberDebtAccount: NonEmpty.optional(),
});
export type ExpenseSettings = z.infer<typeof ExpenseSettings>;

/**
 * POST /api/fortnox/sync: pull the ledger. `financialYearId` is Fortnox's own id for a financial year (a small integer
 * like 9, not a calendar year), as `syncLedger` and the CLI's `--year` mean it.
 */
export const FortnoxSync = z.object({
  scope: z.enum(["current", "all"]).default("current"),
  financialYearId: z.int().positive().optional(),
});
export type FortnoxSync = z.infer<typeof FortnoxSync>;

/**
 * POST /api/mileage/rates and PATCH /api/mileage/rates/[id]: what a kilometre is worth, from a given day.
 * `orePerKm`, not kronor per mil (the screen converts). Bounded because a slipped decimal affects every later claim.
 */
export const MileageRateInput = z.object({
  orePerKm: z.int().positive().max(10000),
  validFrom: IsoDate,
  note: Clearable(Trimmed).optional(),
});
export type MileageRateInput = z.infer<typeof MileageRateInput>;

// ── Authority (Inställningar → Roller) ────────────────────────────
// Roles and capabilities arrive as bare strings and are checked against the vocabulary here: these bodies are the only
// way into the tables every gate reads.

export const RoleName = z.enum(ROLES as [Role, ...Role[]]);

/**
 * The capabilities a settings screen may write. Written out, not derived from the Prisma enum, so a request body does
 * not silently widen; `admin.test.ts` holds the two lists together.
 */
export const CapabilityName = z.enum([
  "ADMIN",
  "BOOKKEEPING",
  "FORTNOX_LOGIN",
  "EXPORT_UNDO",
  "SETTINGS",
  "GRANT_ACCESS",
  "ALCOHOL_STOCK_VIEW",
  "ALCOHOL_STOCK_MANAGE",
  "CAFE_STOCK_VIEW",
  "CAFE_STOCK_MANAGE",
  "BOARD_TAB",
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
  "REVIEW_OWN_BOOKING",
  "BOOKKEEPING_VIEW",
  "AUDIT_REVIEW",
  "MEMBER_SCORE_VIEW",
]);

/**
 * PUT /api/authority/groups: the roles one Authentik group confers. The whole set for one group, not a delta, so two
 * people saving at once cannot interleave. The group is lower-cased (`normaliseGroup` in lib/server/authentik-roles.ts).
 * Which result units a group answers for is set on the unit (PutResultUnitGroups), and a stock place's groups on the place.
 */
export const PutGroupGrant = z.object({
  group: NonEmpty.toLowerCase(),
  roles: z.array(RoleName),
});
export type PutGroupGrant = z.infer<typeof PutGroupGrant>;

/** DELETE is by group name, which is the row's identity. */
export const DeleteGroupGrant = z.object({ group: NonEmpty.toLowerCase() });
export type DeleteGroupGrant = z.infer<typeof DeleteGroupGrant>;

/** PUT /api/authority/capabilities: everything one role may do (the finished state, since the lockout check needs an outcome). */
export const PutRoleCapabilities = z.object({
  role: RoleName,
  capabilities: z.array(CapabilityName),
});
export type PutRoleCapabilities = z.infer<typeof PutRoleCapabilities>;

/**
 * POST /api/access-grants: give one member a role or a capability of their own. Exactly one of the two. `from` and
 * `until` are inclusive Stockholm days; no `from` is now and no `until` is until removed (lib/domain/access-grant.ts).
 */
export const CreateAccessGrant = z
  .object({
    userId: Id,
    role: z
      .enum(GRANTABLE_ROLES as [Role, ...Role[]])
      .nullable()
      .default(null),
    capability: CapabilityName.nullable().default(null),
    from: IsoDate.nullable().default(null),
    until: IsoDate.nullable().default(null),
  })
  .refine((b) => (b.role === null) !== (b.capability === null), { path: ["role"] });
export type CreateAccessGrant = z.input<typeof CreateAccessGrant>;

/**
 * PUT /api/profile/notifications: switch one kind of email on or off for the signed-in member. The weekly digest is not
 * switchable.
 */
export const PutNotificationPreference = z.object({
  kind: z.enum(SWITCHABLE_KINDS as [NotificationKind, ...NotificationKind[]]),
  enabled: z.boolean(),
});
export type PutNotificationPreference = z.infer<typeof PutNotificationPreference>;

/** PUT /api/profile/guides: guide steps the reader has been shown. */
export const PutSeenGuideSteps = z.object({
  steps: z
    .array(z.enum(GUIDE_STEP_IDS as [string, ...string[]]))
    .min(1)
    .max(GUIDE_STEP_IDS.length),
});
export type PutSeenGuideSteps = z.infer<typeof PutSeenGuideSteps>;

/**
 * POST /api/users/[id]/test-email: send one member a test mail of any kind,
 * the digest included.
 */
export const SendTestEmail = z.object({
  kind: z.enum(ALL_KINDS as [NotificationKind, ...NotificationKind[]]),
});
export type SendTestEmail = z.infer<typeof SendTestEmail>;
