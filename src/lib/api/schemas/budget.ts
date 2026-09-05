// Request bodies for the budget tool: /api/budgets, and the per-entity routes
// (/api/budget-sheets, /api/budget-accounts, /api/budget-line-items,
// /api/budget-variables, /api/budget-comments) that hang off it.
import { z } from "zod";
import { Clearable, Id, IsoDate, NonEmpty, Trimmed, UpperCode, Year } from "./common";

const AccountKind = z.enum(["INCOME", "COST"]);

/** POST /api/budgets: a new budget, optionally copied from an existing one. */
export const CreateBudget = z.object({
  year: Year.default(() => new Date().getFullYear()),
  name: NonEmpty.default("Ursprunglig"),
  copyFromId: Clearable(Id).optional(),
});
export type CreateBudget = z.infer<typeof CreateBudget>;

/**
 * POST /api/budgets/import: the query half of a budget CSV upload.
 *
 * The file itself is the request body (raw bytes, so its encoding survives to
 * be sniffed), which leaves the year and the name to travel as query
 * parameters. Same defaults as CreateBudget: an import is a budget being
 * created, and the two should not disagree about what an unnamed one is called.
 */
export const ImportBudgetQuery = z.object({
  year: Year.default(() => new Date().getFullYear()),
  name: NonEmpty.default("Ursprunglig"),
});
export type ImportBudgetQuery = z.infer<typeof ImportBudgetQuery>;

/**
 * PATCH /api/budgets/[id].
 *
 * Two different gates behind one endpoint: `locked` is the treasurer's alone,
 * `name`/`year` are any admin's on an unlocked budget. The route still splits
 * on which one is present. This only says what each may be.
 */
export const PatchBudget = z.object({
  locked: z.boolean().optional(),
  name: NonEmpty.optional(),
  year: Year.optional(),
  // Clearable: a budget recorded as adopted by mistake has to be able to go
  // back to being a draft, and an absent field means "not touching it", which
  // is not the same statement as "never adopted".
  adoptedAt: Clearable(IsoDate).optional(),
});
export type PatchBudget = z.infer<typeof PatchBudget>;

/** POST /api/budgets/[id]/cost-centers: add a sheet, or clone one. */
export const CreateSheet = z.object({
  costCenterId: Clearable(Id).optional(),
  cloneFromId: Clearable(Id).optional(),
});
export type CreateSheet = z.infer<typeof CreateSheet>;

/** PATCH /api/budget-sheets/[id]. */
export const PatchSheet = z.object({
  costCenterId: Clearable(Id).optional(),
  label: Clearable(Trimmed).optional(),
  sortOrder: z.int().optional(),
});
export type PatchSheet = z.infer<typeof PatchSheet>;

/** POST /api/budgets/[id]/cost-centers/[ccid]/accounts. */
export const CreateAccount = z.object({
  accountCode: Trimmed.default(""),
  kindOverride: Clearable(AccountKind).optional(),
});
export type CreateAccount = z.infer<typeof CreateAccount>;

/** PATCH /api/budget-accounts/[id]. */
export const PatchAccount = z.object({
  accountCode: NonEmpty.optional(),
  kindOverride: Clearable(AccountKind).optional(),
});
export type PatchAccount = z.infer<typeof PatchAccount>;

/** POST /api/budget-accounts/[id]/line-items: a new row on an account. */
export const CreateLineItem = z.object({
  description: Trimmed.default(""),
  // A row with no equation is a zero, not an error: the sheet is filled in
  // gradually and a blank Belopp is where somebody has not got to yet.
  expression: Trimmed.default("0"),
});
export type CreateLineItem = z.infer<typeof CreateLineItem>;

/** PATCH /api/budget-line-items/[id]. */
export const PatchLineItem = z.object({
  description: NonEmpty.optional(),
  expression: Trimmed.optional(),
  sortOrder: z.int().optional(),
  // The "antal × á-pris" form. Both are expression strings like `expression`
  // itself, and an empty one clears the pair back to a standalone equation.
  quantity: Clearable(Trimmed).optional(),
  unitPrice: Clearable(Trimmed).optional(),
  // Per-line values for the general-purpose columns, merged into the row's
  // `values` JSON. An empty string clears that column's cell.
  columnValues: z.record(z.string(), z.string()).optional(),
});
export type PatchLineItem = z.infer<typeof PatchLineItem>;

/** PUT /api/budget-accounts/[id]/line-items/reorder. */
export const ReorderLineItems = z.object({
  orderedIds: z.array(Id).default([]),
});
export type ReorderLineItems = z.infer<typeof ReorderLineItems>;

/**
 * POST /api/budgets/[id]/cost-centers/[ccId]/paste: copied rows or accounts,
 * named by what they were copied from rather than by their contents.
 *
 * Ids and not values: a row is a description, an equation, an antal × á-pris and
 * six general columns, and a copy that listed them would be a second description
 * of a row for the paste to get wrong. The server has the originals.
 */
export const PasteIntoSheet = z.object({
  /** Rows to append, and the account of this sheet to append them to. */
  accountId: Id.optional(),
  lineItemIds: z.array(Id).default([]),
  /** Accounts to bring over whole, merged into this sheet's own by code. */
  accountIds: z.array(Id).default([]),
});
export type PasteIntoSheet = z.infer<typeof PasteIntoSheet>;

/** POST /api/budgets/[id]/variables. */
export const CreateVariable = z.object({
  name: UpperCode.pipe(NonEmpty),
  expression: Trimmed.default("0"),
});
export type CreateVariable = z.infer<typeof CreateVariable>;

/** PATCH /api/budget-variables/[id]. */
export const PatchVariable = z.object({
  name: UpperCode.pipe(NonEmpty).optional(),
  expression: Trimmed.optional(),
  sortOrder: z.int().optional(),
});
export type PatchVariable = z.infer<typeof PatchVariable>;

/** POST /api/budget-accounts/[id]/comments, PATCH /api/budget-comments/[id]. */
export const BudgetCommentBody = z.object({
  body: NonEmpty,
});
export type BudgetCommentBody = z.infer<typeof BudgetCommentBody>;

/**
 * One account's share of a redaktionell ändring.
 *
 * `amount` is öre and may be sent as the string somebody typed. The belopp
 * field is free text so a Swede can write "1 234,50", which `parseAmount` in
 * lib/budget/changes.ts turns into öre. A number is taken as öre already.
 */
const ChangeEntryInput = z.object({
  costCenterId: Id,
  accountCode: Trimmed,
  amount: z.union([z.number(), z.string()]),
});
type ChangeEntryInput = z.infer<typeof ChangeEntryInput>;

/** POST /api/budgets/[id]/changes. */
export const CreateChange = z.object({
  kind: z.enum(["AVSTEG", "FORFLYTTNING"]),
  reason: Trimmed.default(""),
  entries: z.array(ChangeEntryInput).default([]),
});
export type CreateChange = z.infer<typeof CreateChange>;
