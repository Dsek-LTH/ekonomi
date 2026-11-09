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
}

type Translator = (key: string, values?: Record<string, string | number>) => string;

export interface SheetValue {
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
  gut: (n: number | undefined, box?: React.ReactNode) => React.ReactNode;
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

  // ── Ticking and copying (lib: ./use-sheet-clipboard) ─────────────
  isTicked: (kind: "rows" | "accounts", id: string) => boolean;
  marked: { accounts: string[]; rows: string[] };
  tickBox: (kind: "rows" | "accounts", id: string, label: string) => React.ReactNode;

  // ── Dragging a row to a new place ────────────────────────────────
  draggingLineId: string | null;
  liftRef: React.RefObject<HTMLTableRowElement | null>;
  linesOf: (account: Account) => LineItem[];
  startLineDrag: (e: React.PointerEvent, account: Account, li: LineItem) => void;

  // ── The half-typed rows at the bottom of each block ──────────────
  draft: (id: string) => Draft;
  setDraft: (id: string, patch: Partial<Draft>) => void;
  createLine: (accountId: string) => void | Promise<unknown>;
  createAccount: (kind: AccountKind, code: string) => void | Promise<unknown>;

  // ── Comments ─────────────────────────────────────────────────────
  openComments: Set<string>;
  setOpenComments: React.Dispatch<React.SetStateAction<Set<string>>>;
  commentDraft: Record<string, string>;
  setCommentDraft: React.Dispatch<React.SetStateAction<Record<string, string>>>;
}

const Ctx = createContext<SheetValue | null>(null);

export const SheetProvider = Ctx.Provider;

/** The sheet the calling row belongs to. Throws without a provider: that is a wiring mistake. */
export function useSheet(): SheetValue {
  const value = useContext(Ctx);
  if (!value) throw new Error("useSheet must be used inside a SheetProvider");
  return value;
}
