// Bodies for the bokslut routes under /api/closing.
import { z } from "zod";
import { NonEmpty, Trimmed } from "./common";

/**
 * The version of the voucher the screen was showing. A review or a comment is
 * about what somebody saw, so a voucher that has changed since the page loaded
 * is refused rather than recorded against something nobody looked at.
 */
const ContentHash = z.string().min(1);

/** POST /api/closing/[year]/vouchers/[voucher]/review. The pass is the actor's. */
export const ReviewVoucherBody = z.object({
  status: z.enum(["OK", "QUESTION", "REMARK"]),
  contentHash: ContentHash,
});
export type ReviewVoucherBody = z.infer<typeof ReviewVoucherBody>;

/** POST /api/closing/[year]/vouchers/[voucher]/comments. */
export const VoucherCommentBody = z.object({
  body: NonEmpty,
  contentHash: ContentHash,
});
export type VoucherCommentBody = z.infer<typeof VoucherCommentBody>;

/** PATCH /api/closing/[year]/checklist/[item]. Each field is left alone if absent. */
export const ChecklistItemPatch = z.object({
  /** Tick or untick. Refused on an item the app answers by itself. */
  done: z.boolean().optional(),
  note: Trimmed.optional(),
  noteToNextYear: Trimmed.optional(),
});
export type ChecklistItemPatch = z.infer<typeof ChecklistItemPatch>;

/** PUT /api/closing/[year]/accounts/[account]: mark as reconciled in Fortnox. */
export const ReconcileAccountBody = z.object({ note: Trimmed.default("") });
export type ReconcileAccountBody = z.infer<typeof ReconcileAccountBody>;

/** PUT /api/closing/accounts/[account]/note. Empty clears it. */
export const AccountNoteBody = z.object({ body: Trimmed });
export type AccountNoteBody = z.infer<typeof AccountNoteBody>;

const ClosingCheckName = z.enum([
  "EXPENSES_EXPORTED",
  "CARD_PURCHASES_ACCOUNTED",
  "INCOME_EXPORTED",
  "LEDGER_SYNCED",
  "STOCKTAKE_AT_YEAR_END",
  "BALANCES_RECONCILED",
  "TREASURY_REVIEWED",
  "AUDITORS_REVIEWED",
]);

const OwnerRole = z.enum([
  "SKATTMASTARE",
  "ORDFORANDE",
  "VICE_SKATTMASTARE",
  "SKATTFORMAN",
  "RESULTATANSVARIG",
  "STOCKARE",
  "UTHYRNINGSANSVARIG",
  "REVISOR",
  "ORDINARIE",
]);

/** POST /api/closing/template. */
export const TemplateItemBody = z.object({
  title: NonEmpty,
  howTo: Trimmed.default(""),
  ownerRole: OwnerRole.nullable().default(null),
  dueOffsetDays: z.int().min(-366).max(366).nullable().default(null),
  check: ClosingCheckName.nullable().default(null),
});
export type TemplateItemBody = z.input<typeof TemplateItemBody>;

/** PATCH /api/closing/template/[id]. Retiring is `active: false`. */
export const TemplateItemPatch = z.object({
  title: NonEmpty.optional(),
  howTo: Trimmed.optional(),
  ownerRole: OwnerRole.nullable().optional(),
  dueOffsetDays: z.int().min(-366).max(366).nullable().optional(),
  check: ClosingCheckName.nullable().optional(),
  active: z.boolean().optional(),
});
export type TemplateItemPatch = z.infer<typeof TemplateItemPatch>;

/** POST /api/closing/template/[id]/move. */
export const TemplateMoveBody = z.object({ direction: z.enum(["up", "down"]) });
export type TemplateMoveBody = z.infer<typeof TemplateMoveBody>;
