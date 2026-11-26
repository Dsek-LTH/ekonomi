// Request bodies for the budget tool: /api/budgets, and the per-entity routes
// (/api/budget-sheets, /api/budget-accounts, /api/budget-line-items,
// /api/budget-variables, /api/budget-comments) that hang off it.
import { z } from "zod";
import { COMMENT_FIELDS } from "@/lib/budget/payload";
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
 * POST /api/budgets/import: the query half of a budget CSV upload (the file is the raw body, so its encoding can be
 * sniffed). Same defaults as CreateBudget.
 */
export const ImportBudgetQuery = z.object({
  year: Year.default(() => new Date().getFullYear()),
  name: NonEmpty.default("Ursprunglig"),
});
export type ImportBudgetQuery = z.infer<typeof ImportBudgetQuery>;

/** PATCH /api/budgets/[id]. `locked` is the treasurer's alone; `name`/`year` are any admin's on an unlocked budget. */
export const PatchBudget = z.object({
  locked: z.boolean().optional(),
  name: NonEmpty.optional(),
  year: Year.optional(),
  // Clearable: absent means "not touching it", null means back to draft.
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
  /** The section it is added under (3xxx income, 4xxx-8xxx cost), so the server can refuse a code that does not belong. */
  kind: AccountKind,
});
export type CreateAccount = z.infer<typeof CreateAccount>;

/** PATCH /api/budget-accounts/[id]. */
export const PatchAccount = z.object({
  accountCode: NonEmpty.optional(),
});
export type PatchAccount = z.infer<typeof PatchAccount>;

/** POST /api/budget-accounts/[id]/line-items: a new row on an account. */
export const CreateLineItem = z.object({
  description: Trimmed.default(""),
  // A row with no equation is a zero, not an error (the sheet is filled in gradually).
  expression: Trimmed.default("0"),
});
export type CreateLineItem = z.infer<typeof CreateLineItem>;

/** PATCH /api/budget-line-items/[id]. */
export const PatchLineItem = z.object({
  // May be emptied, as a row may be made without one (CreateLineItem), e.g. by moving cut cells.
  description: Trimmed.optional(),
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

/**
 * POST /api/budgets/[id]/cells: a block paste, all or none. `lines` are cells written on
 * existing lines; `create` are new lines at the end of an account, for values that ran past
 * its last line.
 */
export const PatchCells = z
  .object({
    lines: z
      .array(
        z.object({
          id: Id,
          description: Trimmed.optional(),
          expression: Trimmed.optional(),
        }),
      )
      .max(1000)
      .default([]),
    create: z
      .array(z.object({ accountId: Id, description: Trimmed, expression: Trimmed }))
      .max(1000)
      .default([]),
  })
  .refine((b) => b.lines.length + b.create.length > 0, { message: "nothing to write" });
export type PatchCells = z.infer<typeof PatchCells>;

/** POST /api/budgets/[id]/lines/delete: several lines removed at once, all or none. */
export const DeleteLines = z.object({ ids: z.array(Id).min(1).max(1000) });
export type DeleteLines = z.infer<typeof DeleteLines>;

/**
 * POST /api/budgets/[id]/lines/restore: lines made again in one write (undoing a delete of
 * several). `key` is the id the line had, so `orders` (each account's lines as they stood) can
 * name the lines being made alongside those still there.
 */
export const RestoreLines = z.object({
  lines: z
    .array(z.object({ key: Id, accountId: Id, description: Trimmed, expression: Trimmed }))
    .min(1)
    .max(1000),
  orders: z.array(z.object({ accountId: Id, ids: z.array(Id) })).default([]),
});
export type RestoreLines = z.infer<typeof RestoreLines>;

/** PUT /api/budget-accounts/[id]/line-items/reorder. */
export const ReorderLineItems = z.object({
  orderedIds: z.array(Id).default([]),
});
export type ReorderLineItems = z.infer<typeof ReorderLineItems>;

/** POST /api/budgets/[id]/cost-centers/[ccId]/paste: copied rows or accounts, named by id (the server has the originals). */
export const PasteIntoSheet = z.object({
  /** Rows to paste, and the account of this sheet to paste them into. */
  accountId: Id.optional(),
  lineItemIds: z.array(Id).default([]),
  /**
   * A line of `accountId` to paste from: the rows overwrite it and the lines below it, and those
   * that do not fit are added at the account's end. Without it they are all added at the end.
   */
  overwriteFrom: Id.optional(),
  /** Accounts to bring over, merged into this sheet's own by code. */
  accountIds: z.array(Id).default([]),
  /** Only these of the accounts' lines come with them. Without it, all of them. */
  accountLineIds: z.array(Id).optional(),
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

/** POST /api/budget-line-items/[id]/comments: on one of the line's cells. */
export const BudgetLineCommentBody = z.object({
  body: NonEmpty,
  field: z.enum(COMMENT_FIELDS),
});
export type BudgetLineCommentBody = z.infer<typeof BudgetLineCommentBody>;

/**
 * One account's share of a redaktionell ändring. `amount` is öre, or the string somebody typed ("1 234,50"), which
 * `parseAmount` in lib/budget/changes.ts turns into öre.
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
