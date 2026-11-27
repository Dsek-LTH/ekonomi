"use client";

// Everything a budget sheet's rows need to draw themselves, as a context instead of the
// forty-odd props the account block would otherwise take. Anything about one account or one
// row stays an argument.
import { createContext, useContext } from "react";

import type { AccountKind } from "@/lib/budget";
import type { JoinedAccount, JoinedSheet, Totals } from "@/lib/budget/compare";
import type { BudgetGrid, ColumnDef } from "@/lib/budget/grid";
import type { AccountRecord } from "@/lib/domain/types";
import type { AdjustmentRow } from "./budget-helpers";
import type {
  Account,
  ApiFn,
  BudgetCC,
  CellFn,
  Draft,
  Evaluated,
  FormulaFn,
  LineItem,
} from "./budget-types";

export interface SheetCompare {
  label: string;
  sheet: JoinedSheet;
  vsActuals: boolean;
}

type Translator = (key: string, values?: Record<string, string | number>) => string;

import type { UndoStep } from "./use-undo";
import type { CommentTarget, CommentThreads } from "./sheet-comments";
import type { RangeSelect } from "./use-range-select";

export interface SheetValue {
  /** Puts a line made or deleted on the page's ⌘Z history (use-undo.ts). */
  record: (step: UndoStep) => void;
  // ── What the sheet is ────────────────────────────────────────────
  cc: BudgetCC;
  ccCode: string;
  budgetId: string;
  columns: ColumnDef[];
  grid: BudgetGrid;
  ev: Evaluated;
  accounts: AccountRecord[];
  adjustments: Map<string, AdjustmentRow[]>;
  compare: SheetCompare | null;
  showCompare: boolean;

  // ── Who is reading ───────────────────────────────────────────────
  isAdmin: boolean;
  canComment: boolean;
  userId: string;

  // ── How a cell is drawn, and how a write is sent ──────────────────
  renderCell: CellFn;
  renderFormula: FormulaFn;
  api: ApiFn;
  date: (iso: string) => string;

  // ── Layout ───────────────────────────────────────────────────────
  narrow: boolean;
  gut: (
    n: number | undefined,
    handle?: {
      label: string;
      selected: boolean;
      onPointerDown: (e: React.PointerEvent) => void;
      account?: boolean;
    },
  ) => React.ReactNode;
  del: (onClick: () => void, label: string) => React.ReactNode;
  actualPad: React.ReactNode;
  totalCols: number;
  gutWidth: number;
  actionsWidth: number;
  staticWidth: (c: ColumnDef) => number | undefined;

  // ── Wording ──────────────────────────────────────────────────────
  t: Translator;
  tCol: Translator;
  tRam: Translator;
  tChanges: Translator;
  tAlloc: Translator;
  tBook: Translator;
  tLedger: Translator;

  // ── Worked out once for the whole sheet ──────────────────────────
  income: Account[];
  cost: Account[];
  totals: Totals;
  compareTotals: Totals;
  compareAccounts: Map<string, JoinedAccount>;
  changeImpact: number;
  badAccount: Set<string>;
  badLine: Set<string>;
  liUrl: (id: string) => string;
  /** The chart narrowed to what may go under `kind`. `keep` is a row's own account, kept so its value resolves. */
  accountOptionsFor: (kind: AccountKind, keep?: string) => { value: string; label: string }[];

  // ── The row numbers, each its row's handle ───────────────────────
  /** A press on a line's number: select the row, or drag it (cost-center-sheet.tsx). */
  pressRowNumber: (e: React.PointerEvent, li: LineItem) => void;
  /** A press on an account's own number: pick the account (Shift or a drag: several). */
  pressAccountNumber: (e: React.PointerEvent, account: Account) => void;
  /** Whether an account is picked (its number drawn chosen). */
  accountPicked: (id: string) => boolean;
  /** The accounts picked, by the first and last, and the last one's last line (for the box). */
  pickedAccounts: { first: string; last: string; lastLine: string | null } | null;

  // ── Dragging a row to a new place ────────────────────────────────
  draggingLineId: string | null;
  linesOf: (account: Account) => LineItem[];
  /** Each line row's ref, so the drag can carry the row's node (lib/ui/use-row-drag.ts). */
  liftRef: (lineId: string) => (el: HTMLTableRowElement | null) => void;

  // ── The half-typed rows at the bottom of each block ──────────────
  draft: (id: string) => Draft;
  setDraft: (id: string, patch: Partial<Draft>) => void;
  createLine: (accountId: string) => void | Promise<unknown>;
  createAccount: (kind: AccountKind, code: string) => void | Promise<unknown>;

  // ── Comments (./sheet-comments) ──────────────────────────────────
  comments: CommentThreads;
  thread: CommentThreads["thread"];
  /** Half-written comments by target (targetKey). */
  commentDraft: { get: (key: string) => string; set: (key: string, v: string) => void };
  postComment: (target: CommentTarget, body: string) => Promise<boolean>;
  deleteComment: (id: string) => Promise<boolean>;

  // ── The block of cells selected (./use-range-select) ──────────────
  range: RangeSelect;
  /** Whether a cell is being edited (use-cell-edit.ts): only then does Belopp show its formula. */
  editing: boolean;
  /** Rows cut and not yet pasted, drawn faded. */
  cutIds: Set<string>;
  /** Rows copied or cut, in runs of neighbours as drawn, each framed. */
  heldRuns: string[][];
  /** Accounts copied, each framed from its name to the Belopp of its last line (if any). */
  heldAccounts: { id: string; lastLine: string | null }[];
  /** Cells copied or cut and not yet let go: framed, and faded if `cut`. */
  heldCells: { lines: string[]; left: number; right: number; cut: boolean } | null;
}

const Ctx = createContext<SheetValue | null>(null);

export const SheetProvider = Ctx.Provider;

/** The sheet the calling row belongs to. Throws without a provider: that is a wiring mistake. */
export function useSheet(): SheetValue {
  const value = useContext(Ctx);
  if (!value) throw new Error("useSheet must be used inside a SheetProvider");
  return value;
}
