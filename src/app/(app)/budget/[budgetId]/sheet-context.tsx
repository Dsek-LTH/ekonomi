"use client";

// Everything a budget sheet's rows need to draw themselves.
//
// The sheet is one screen made of four nested things: a section card holds
// account blocks, an account block holds line rows, a line row holds cells,
// and every level of it needs the same handful of answers: which columns there
// are, what a formula evaluates to, whether this reader may write, what a cell
// looks like, what is ticked, what is being dragged.
//
// Passed down as props that came to forty-two on the account block alone, which
// is why they were not props: the blocks were closures inside the component,
// and the coupling was real but invisible. A context makes the same coupling
// explicit and stops it being paid for at every level in between. The section
// card no longer takes eleven arguments it only forwards.
//
// What is *not* in here: anything about one account or one row. Those are the
// arguments a block genuinely has, and they stayed arguments.
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

/** The subset of next-intl's translator these blocks ask for. */
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
  /** Editorial adjustments in force, by account id. */
  adjustments: Map<string, AdjustmentRow[]>;
  compare: SheetCompare | null;
  /** Whether the comparison columns are actually drawn (narrow screens hide them). */
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
  /** True on a phone, where the gutter and the comparison columns go away. */
  narrow: boolean;
  /** The line-number gutter cell, with an optional box in it. */
  gut: (n: number | undefined, box?: React.ReactNode) => React.ReactNode;
  /** The reveal-on-hover delete button every removable row carries. */
  del: (onClick: () => void, label: string) => React.ReactNode;
  /** The two spacer cells that keep the actual columns aligned under compare. */
  actualPad: React.ReactNode;
  /** How many cells a full-width row (a comment) has to span. */
  totalCols: number;
  gutWidth: number;
  /** The width of the trailing actions column. */
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
  /** Accounts whose formula the evaluator could not resolve. */
  badAccount: Set<string>;
  badLine: Set<string>;
  liUrl: (id: string) => string;
  /** The chart, minus the codes this sheet already has (`keep` stays offered). */
  /** The chart, narrowed to what may go under `kind` on this sheet. `keep` is
   *  a row's own account, kept in its own picker so the value resolves. */
  accountOptionsFor: (kind: AccountKind, keep?: string) => { value: string; label: string }[];

  // ── Dropping an account into the other section ───────────────────
  //
  // ── Ticking and copying (lib: ./use-sheet-clipboard) ─────────────
  isTicked: (kind: "rows" | "accounts", id: string) => boolean;
  marked: { accounts: string[]; rows: string[] };
  tickBox: (kind: "rows" | "accounts", id: string, label: string) => React.ReactNode;

  // ── Dragging a row to a new place ────────────────────────────────
  draggingLineId: string | null;
  liftRef: React.RefObject<HTMLTableRowElement | null>;
  /** A account's rows in the order the sheet currently shows them. */
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

/**
 * The sheet the calling row belongs to.
 *
 * Throws rather than handing back a default: every one of these blocks is drawn
 * inside a sheet by construction, so a missing provider is a wiring mistake and
 * not a state to render around.
 */
export function useSheet(): SheetValue {
  const value = useContext(Ctx);
  if (!value) throw new Error("useSheet must be used inside a SheetProvider");
  return value;
}
