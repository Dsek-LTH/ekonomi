// The per-cost-centre sheet: income and costs as two cards of account, line-item and Summa
// rows. Owns the drag handlers and per-sheet drafts; select/edit comes from useCellEdit.
import { Button, SOFT_FILL } from "@/components/ui/button";
import { SelectionBar } from "@/components/selection-bar";
import { Kbd } from "@/components/ui/kbd";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { effectiveKind, isResultAccount, type AccountKind } from "@/lib/budget";
import { sheetTotals, ZERO_TOTALS, type JoinedSheet } from "@/lib/budget/compare";
import { toStored, type BudgetGrid, type ColumnDef } from "@/lib/budget/grid";
import { belowMiddle, placeAmong, useRowDrag } from "@/lib/ui/use-row-drag";
import { useFormat } from "@/lib/ui/use-format";
import { usePhone } from "@/lib/ui/media";
import { cn } from "@/lib/ui/utils";
import { IconButton } from "@/components/ui/icon-button";
import { IconComment, IconCopy, IconPaste, IconScissors, IconTrash } from "@/components/ui/icons";
import { ContextMenu, MenuItem } from "@/components/ui/menu";
import type { CommentField } from "@/lib/budget/payload";
import { resultImpact } from "@/lib/budget/changes";

import {
  ccTotals,
  compareDiff,
  landsInside,
  diffClass,
  fmt,
  fmtSigned,
  normalizeFormula,
  type AdjustmentRow,
} from "./budget-helpers";
import {
  withComment,
  withLine,
  withLineOrder,
  withNewAccount,
  withoutComment,
  withoutLine,
  withLineFields,
  withSheet,
} from "./patch-budget";
import {
  CommentPanel,
  commentsAt,
  targetKey,
  useCommentThreads,
  type CommentTarget,
} from "./sheet-comments";
import { useCellEdit, type RangeKeys } from "./use-cell-edit";
import {
  amountForCopy,
  headerKey,
  isHeaderKey,
  RANGE_COLS,
  useRangeSelect,
} from "./use-range-select";
import type { UndoStep } from "./use-undo";
import { useSheetClipboard } from "./use-sheet-clipboard";
import { SheetProvider, type SheetValue } from "./sheet-context";
import { SheetGrid, SheetHeader } from "./sheet-section";
import { useNotify } from "@/components/shell/notifications";
import type { AccountRecord } from "@/lib/domain/types";
import type {
  Account,
  Budget,
  BudgetCC,
  BudgetClip,
  Comment,
  Evaluated,
  LineItem,
  Draft,
  CellFn,
  FormulaFn,
  ApiFn,
} from "./budget-types";

export interface SheetCompare {
  label: string;
  sheet: JoinedSheet;
  vsActuals: boolean;
}

export function CostCenterSheet(props: {
  cc: BudgetCC;
  ccCode: string;
  ev: Evaluated;
  grid: BudgetGrid;
  columns: ColumnDef[];
  compare: SheetCompare | null;
  isAdmin: boolean;
  canComment: boolean;
  userId: string;
  renderCell: CellFn;
  renderFormula: FormulaFn;
  /** The formula bar (use-budget-cells.tsx), drawn above the sheet. */
  formulaBar: ReactNode;
  /** Drop a cell's edit buffer after writing it from outside (use-budget-cells.tsx). */
  forgetCell: (id: string, field: string) => void;
  api: ApiFn;
  budgetId: string;
  accounts: AccountRecord[];
  adjustments: Map<string, AdjustmentRow[]>;
  clip: BudgetClip | null;
  onCopy: (clip: BudgetClip | null) => void;
  /** Puts a line made or deleted on the page's ⌘Z history (use-undo.ts). */
  record: (step: UndoStep) => void;
}) {
  const {
    cc,
    ccCode,
    ev,
    grid,
    columns,
    compare,
    isAdmin,
    canComment,
    userId,
    renderCell,
    renderFormula,
    formulaBar,
    forgetCell,
    api,
    budgetId,
    accounts,
    adjustments,
    clip,
    onCopy,
    record,
  } = props;
  const t = useTranslations("budget.sheet");
  const tCol = useTranslations("budget.col");
  const tRam = useTranslations("budget.rambudget");
  const tChanges = useTranslations("budget.changes");
  const tAlloc = useTranslations("allocation");
  const tGroup = useTranslations("budget.compareGroups");
  const tBook = useTranslations("book");
  const tLedger = useTranslations("ledger");
  const { date } = useFormat();

  // The block of cells (use-range-select.ts) is made further down, once the rows are known;
  // the cell keys reach it through this ref.
  const rangeKeys = useRef<RangeKeys | null>(null);
  // Accounts picked by their own numbers (a click, Shift+click, or a drag over them): each with
  // its header row and lines, for copying whole accounts. Apart from the block of cells: picking
  // one lets go of the other.
  const [accountPick, setAccountPick] = useState<{ from: string; to: string } | null>(null);
  // Cells last copied (⌘C) or cut (⌘X): where they are, framed until let go, and the text they
  // put on the system clipboard, so a paste can tell it is those values coming back. A cut is
  // also faded, and its cells are emptied once pasted.
  const [heldCells, setHeldCells] = useState<{
    lines: string[];
    left: number;
    right: number;
    text: string;
    cut: boolean;
  } | null>(null);
  const cellEdit = useCellEdit("space-y-4", rangeKeys);
  const notify = useNotify();

  // Sheet-local UI state: the open comment thread, half-written comments (by target, so one
  // survives closing its thread), the right-click menu, and drafts for the new-row inputs.
  const comments = useCommentThreads();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const commentDraft = {
    get: (key: string) => drafts[key] ?? "",
    set: (key: string, v: string) => setDrafts((m) => ({ ...m, [key]: v })),
  };
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    anchor: HTMLElement;
    items: { target: CommentTarget; label: string }[];
  } | null>(null);
  const [newRow, setNewRow] = useState<Record<string, Draft>>({});

  const badLine = new Set(ev.badLineItems);
  const badAccount = new Set(ev.badAccounts);
  // Accounts whose total is short a row that did not resolve (the figure is the sum of the rest).
  // Left margin: the row number, which is the row's handle as in a spreadsheet. A click
  // selects the row (Shift: the rows to it), a press and drag moves it (`startLineDrag`).
  // `table-fixed` sizes from the colgroup, so a 0px column with padded cells overflows into its
  // neighbour; on a phone the cell is emptied instead.
  const gut = (
    n: number | undefined,
    handle?: {
      label: string;
      selected: boolean;
      onPointerDown: (e: React.PointerEvent) => void;
      /** An account's own number (picks the account), not a line's. */
      account?: boolean;
    },
  ) => {
    if (narrow) return <td className="p-0" />;
    return (
      <td
        className={cn(
          "relative select-none border-r border-border/60 p-0 align-middle",
          handle?.selected && SOFT_FILL,
        )}
      >
        {handle ? (
          <button
            type="button"
            data-row-number
            data-account-number={handle.account || undefined}
            tabIndex={-1}
            aria-label={handle.label}
            title={handle.label}
            onPointerDown={handle.onPointerDown}
            className={cn(
              "flex h-7 w-full cursor-pointer items-center justify-center text-[11px] tabular-nums",
              handle.selected ? "font-medium text-foreground" : "text-faint hover:text-muted",
            )}
          >
            {n ?? ""}
          </button>
        ) : (
          <span className="flex h-7 items-center justify-center text-[11px] tabular-nums text-faint">
            {n ?? ""}
          </span>
        )}
      </td>
    );
  };

  // Row delete, revealed on hover or keyboard focus.
  const del = (onClick: () => void, label: string) => (
    <IconButton size="sm" tone="danger" reveal onClick={onClick} label={label}>
      <IconTrash className="size-4" />
    </IconButton>
  );

  const income = cc.accounts.filter((a) => effectiveKind(a.accountCode) === "INCOME");
  const cost = cc.accounts.filter((a) => effectiveKind(a.accountCode) === "COST");
  const totals = ccTotals(cc, ev);

  // How much of the result is editorial changes (already in the totals above).
  const changeImpact = cc.accounts.reduce((sum, a) => {
    const net = (adjustments.get(a.id) ?? []).reduce((s, r) => s + r.amount, 0);
    return sum + resultImpact(effectiveKind(a.accountCode), net);
  }, 0);

  // The comparison (utfall or another budget, see use-comparison.tsx) adds two non-grid
  // columns after Belopp. What only the other side has (`ghostAccounts`, rows missing here)
  // renders read-only and unbudgeted, since the blank is the finding.
  // Below md there is 361px of screen for 506px of fixed columns: chrome and the comparison give.
  const narrow = usePhone();
  const [compareOnPhone, setCompareOnPhone] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const showCompare = compare !== null && (!narrow || compareOnPhone);
  const compareTotals = compare ? sheetTotals(compare.sheet, 1) : ZERO_TOTALS;
  const compareAccounts = new Map((compare?.sheet.accounts ?? []).map((a) => [a.code, a]));
  const ownCodes = new Set(cc.accounts.map((a) => a.accountCode));
  // Only while the comparison columns show: a ghost row's content is all in them.
  const ghostAccounts = showCompare
    ? compare.sheet.accounts.filter((a) => !ownCodes.has(a.code))
    : [];
  const actualPad = showCompare ? (
    <>
      <td className="border-l border-border/40" />
      <td />
    </>
  ) : null;

  const totalCols = columns.length + 2 + (showCompare ? 2 : 0); // full-width spanners
  const liUrl = (id: string) => `/api/budget-line-items/${id}`;

  // Fixed widths; Beskrivning is elastic. On a phone (361px) the desktop set leaves
  // Beskrivning nothing, so chrome shrinks: gutter 58 to 0 (drag is not usable on touch),
  // konto 110 to 26 (just the elbow), belopp 260 to 110 (equation is shown on tap, see
  // `compact` in use-budget-cells.tsx).
  // The margin holds one thing at a time (number or tick box). The actions hold only the delete
  // (a 24px icon button and its cell's padding), the same at every width.
  const GUT_W = narrow ? 0 : 36,
    ACT_W = 32;
  const staticWidth = (c: ColumnDef): number | undefined =>
    c.key === "beskrivning"
      ? undefined
      : c.key === "konto"
        ? narrow
          ? 26
          : 110
        : narrow
          ? 110
          : 260;

  const draft = (id: string): Draft => newRow[id] ?? { description: "", expression: "" };
  const setDraft = (id: string, patch: Partial<Draft>) =>
    setNewRow((m) => ({ ...m, [id]: { ...draft(id), ...patch } }));

  // Accounts whose blank row is being saved. Enter and then leaving the row both ask, from the
  // same render's draft, and would otherwise make the line twice.
  const creating = useRef(new Set<string>());

  async function createLine(accountId: string) {
    const d = newRow[accountId];
    if (!d || (!d.description.trim() && !d.expression.trim())) return;
    if (creating.current.has(accountId)) return;
    creating.current.add(accountId);
    // Bound like an edit of an existing cell (commitFormula in use-budget-cells.tsx), or a typed
    // "=#3" is stored as written and never resolves.
    const expression = toStored(normalizeFormula(d.expression), ccCode, grid) || "0";
    const body = { description: d.description.trim(), expression };
    // Emptied at once, so the blank row is ready for the next line while this one saves.
    setNewRow((m) => {
      const n = { ...m };
      delete n[accountId];
      return n;
    });
    try {
      // The route returns the row it made, so no re-read of the budget is needed.
      const order = cc.accounts.find((a) => a.id === accountId)?.lineItems.map((l) => l.id) ?? [];
      const ok = await api(
        `/api/budget-accounts/${accountId}/line-items`,
        "POST",
        body,
        (b, data) => withLine(b, accountId, data as LineItem),
        (data) => {
          const lineId = (data as LineItem).id;
          record({
            kind: "line",
            created: true,
            accountId,
            lineId,
            body,
            order: [...order, lineId],
          });
        },
      );
      // Refused: the text comes back, unless something new has been written there since.
      if (!ok) setNewRow((m) => (m[accountId] ? m : { ...m, [accountId]: d }));
    } finally {
      creating.current.delete(accountId);
    }
  }

  // Accounts come from the synced chart; those already on the sheet are filtered out except
  // `keep` (the row's own). Balance accounts (1xxx, 2xxx) are never offered, and a section
  // only offers its own side (3xxx under Intäkter, 4xxx-8xxx under Kostnader). The server
  // refuses the rest too (lib/budget/account-validation.ts).
  const used = new Set(cc.accounts.map((a) => a.accountCode));
  const accountOptionsFor = (kind: AccountKind, keep?: string) =>
    accounts
      .filter((a) =>
        a.number === keep
          ? true
          : a.active &&
            !used.has(a.number) &&
            isResultAccount(a.number) &&
            effectiveKind(a.number) === kind,
      )
      .map((a) => ({ value: a.number, label: `${a.number} - ${a.name}`, short: a.number }));

  async function createAccount(kind: AccountKind, code: string) {
    if (!code.trim()) return;
    // The server resolves the name from the chart, so the new account comes from the response.
    await api(
      `/api/budgets/${budgetId}/cost-centers/${cc.id}/accounts`,
      "POST",
      // The section, so the server can refuse a code that does not belong on it.
      { accountCode: code.trim(), kind },
      (b, data) => withNewAccount(b, cc.id, data as Account),
    );
  }

  /**
   * Reordering a line by hand, within its account or onto another one, with the row drag shared with the kontering
   * (lib/ui/use-row-drag.ts). The sheet's table keeps separate borders (sheet-section.tsx) so a carried row takes its
   * column rules with it. Reclassifying a whole account by dropping it on the other section is still HTML5.
   */
  interface LineDrag {
    id: string;
    fromAccountId: string;
    accountId: string;
    ids: Record<string, string[]>;
    before: Record<string, string[]>;
  }
  // The placement to draw: the drag's while in the air, and until the saved sheet returns
  // (else the sheet would spring back during the save).
  const [placement, setPlacement] = useState<Record<string, string[]> | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  // Every row by id, since a placement can hold a row carried out of its server account.
  const lineById = new Map(cc.accounts.flatMap((a) => a.lineItems.map((l) => [l.id, l] as const)));

  function linesOf(account: Account): LineItem[] {
    const ids = placement?.[account.id];
    if (!ids) return account.lineItems;
    return ids.map((id) => lineById.get(id)).filter((l): l is LineItem => Boolean(l));
  }

  function place(d: LineDrag, accountId: string, overId: string | null, after: boolean) {
    const list = d.ids[accountId];
    if (!list) return;
    const ids: Record<string, string[]> = {};
    for (const [key, l] of Object.entries(d.ids)) ids[key] = l.filter((x) => x !== d.id);
    ids[accountId] = placeAmong(list, d.id, overId, after);
    if (accountId === d.accountId && ids[accountId].join() === d.ids[accountId].join()) return;
    d.ids = ids;
    d.accountId = accountId;
    setPlacement(ids);
  }

  // Drawn order: Intäkter, then Kostnader, each account's rows as they stand (mid-drag too).
  // Each account's own row comes first, then its lines: the block can take the account's row
  // (its name and total) as well as its lines'.
  const lineOrder = [...income, ...cost].flatMap((a) => [
    headerKey(a.id),
    ...linesOf(a).map((l) => l.id),
  ]);
  // Which account each line (and account row) is drawn under: a block, and a paste, stay inside one.
  const accountOfLine = new Map(
    cc.accounts.flatMap((a) => [
      [headerKey(a.id), a] as const,
      ...linesOf(a).map((l) => [l.id, a] as const),
    ]),
  );
  const range = useRangeSelect({
    order: lineOrder,
    accountOf: (id) => accountOfLine.get(id)?.id,
    sheetRef,
    isEditing: () => cellEdit.className.includes("is-editing"),
  });

  /**
   * A block that spans the whole row (Beskrivning and Belopp) over two rows or more is those
   * rows, as selecting whole rows is in a spreadsheet. Anything narrower is cells: their values,
   * never the rows they sit on. The bar says which (rader or celler), so a copy is never a guess.
   */
  // Whole rows selected (by their numbers, ⌘-clicked, or a block across the row).
  const blockIsRows = range.rows.length > 0;
  /**
   * A block across the row that takes an account's own row: that account, with the lines in the
   * block (some, all or none), copied and pasted together.
   */
  const blockAccount = (() => {
    if (!blockIsRows) return null;
    const header = range.rows.find(isHeaderKey);
    const account = header ? accountOfLine.get(header) : undefined;
    return account ? { account, lines: range.rows.filter((id) => !isHeaderKey(id)) } : null;
  })();

  /**
   * ⌘C on a block: tab-separated, a line per row, what the cells show (Belopp as kronor), for
   * a spreadsheet elsewhere. A block of whole rows is also put on the page's clipboard as those
   * rows, as Kopiera rader would, so ⌘V in an account here pastes them as rows.
   */
  function copyRange(): boolean {
    if (chosenAccounts.length > 0) {
      copyAccounts();
      return true;
    }
    // Whole rows: their two columns, even when picked apart with ⌘-click. Else the block's.
    const rect = blockIsRows ? { left: 0, right: RANGE_COLS.length - 1 } : range.rect;
    if (!rect || (!blockIsRows && !range.multi)) return false;
    const lines = blockIsRows ? range.rows : range.lines;
    const text = blockText(lines, rect.left, rect.right);
    void navigator.clipboard.writeText(text).catch(() => {});
    // The whole account (its row and all its lines): copied as the account, as its number does.
    if (blockAccount) {
      onCopy({
        kind: "accounts",
        ids: [blockAccount.account.id],
        label: blockAccount.account.accountCode,
        lineIds: blockAccount.lines,
      });
      setHeldCells(null);
      range.clear();
    } else if (blockIsRows) copyRows(rowsChosen(), false);
    else holdCells(lines, rect.left, rect.right, text, false);
    return true;
  }

  /**
   * ⌘C on the one selected cell: its value in the same form as a block's (Belopp as kronor, not
   * what the cell shows, which for a formula is its working too), framed like a block.
   */
  function copyCell(input: HTMLInputElement): boolean {
    const line = input.closest<HTMLElement>("tr[data-line]")?.dataset.line;
    const col = Number(input.closest<HTMLElement>("td[data-range-col]")?.dataset.rangeCol);
    if (!line || !Number.isFinite(col)) return false;
    const text = blockText([line], col, col);
    void navigator.clipboard.writeText(text).catch(() => {});
    holdCells([line], col, col, text, false);
    return true;
  }

  /** A block's values as a spreadsheet takes them: a line per row, tabs between columns. */
  function blockText(lines: string[], left: number, right: number): string {
    const cols = RANGE_COLS.slice(left, right + 1);
    return lines
      .map((id) => {
        // An account's own row: its name and its total.
        const account = isHeaderKey(id) ? accountOfLine.get(id) : undefined;
        return cols
          .map((c) =>
            account
              ? c === "description"
                ? account.accountName
                : amountForCopy(ev.accounts[`${ccCode}:${account.accountCode}`])
              : c === "description"
                ? (lineById.get(id)?.description ?? "")
                : amountForCopy(ev.lineItems[id]),
          )
          .join("\t");
      })
      .join("\n");
  }

  /**
   * ⌘X on cells (a block, or the one selected cell): their values go on the system clipboard
   * and the cells are marked, faded and framed. The next ⌘V of those values moves them: written
   * from the selected cell and emptied where they were (`pasteBlock`).
   */
  function cutCellsHere(): boolean {
    if (!isAdmin) return false;
    let lines: string[];
    let left: number;
    let right: number;
    if (range.multi && range.rect) {
      lines = range.lines;
      left = range.rect.left;
      right = range.rect.right;
    } else {
      const el = document.activeElement as HTMLElement | null;
      const line = el?.closest<HTMLElement>("tr[data-line]")?.dataset.line;
      const col = Number(el?.closest<HTMLElement>("td[data-range-col]")?.dataset.rangeCol);
      if (!line || !sheetRef.current?.contains(el) || !Number.isFinite(col)) return false;
      lines = [line];
      left = right = col;
    }
    const text = blockText(lines, left, right);
    void navigator.clipboard.writeText(text).catch(() => {});
    holdCells(lines, left, right, text, true);
    return true;
  }

  /** Cells copied or cut: framed (and faded, if cut) until pasted, let go or replaced. */
  function holdCells(lines: string[], left: number, right: number, text: string, cut: boolean) {
    if (clip) onCopy(null);
    setHeldCells({ lines, left, right, text, cut });
    // Let go of the block, so the bar turns to what was taken and how to paste it.
    range.clear();
  }

  /**
   * ⌘V of several values on a selected cell: written from that cell down and to the right, within
   * its account (nothing past Belopp, never into the next account). Rows past the account's last
   * line become new lines at its end. When they are the cells cut with ⌘X, those are emptied
   * after, except where they were written over. One value is left to the cell's own paste
   * (use-budget-cells.tsx), unless it is a cut.
   */
  function onPasteCapture(e: React.ClipboardEvent) {
    const el = e.target as HTMLElement;
    if (!isAdmin || !(el instanceof HTMLInputElement) || el.dataset.cell === undefined) return;
    if (cellEdit.className.includes("is-editing")) return; // typing: the caret takes it
    const line = el.closest<HTMLElement>("tr[data-line]")?.dataset.line;
    const col = Number(el.closest<HTMLElement>("td[data-range-col]")?.dataset.rangeCol);
    if (!line || !Number.isFinite(col)) return;
    const text = e.clipboardData.getData("text/plain").replace(/\r?\n$/, "");
    const moving = heldCells?.cut === true && text === heldCells.text;
    const rows = text.split(/\r?\n/).map((r) => r.split("\t"));
    if (!moving && rows.length === 1 && rows[0].length === 1) return;
    e.preventDefault();
    e.stopPropagation();
    void pasteBlock(line, col, rows, moving ? heldCells : null);
  }

  async function pasteBlock(
    line: string,
    col: number,
    rows: string[][],
    from: { lines: string[]; left: number; right: number } | null,
  ) {
    // A cut is spent once pasted; a copy stays framed, to be pasted again.
    if (from) setHeldCells(null);
    // Every cell the paste changes, worked out first and then sent as one write, so the block
    // lands at once (and is one ⌘Z step) rather than cell by cell.
    const changes = new Map<string, Partial<Record<(typeof RANGE_COLS)[number], string>>>();
    const before = new Map<string, Partial<Record<(typeof RANGE_COLS)[number], string>>>();
    const put = (id: string, field: (typeof RANGE_COLS)[number], value: string) => {
      const li = lineById.get(id);
      if (!li) return;
      const stored =
        field === "expression" ? toStored(normalizeFormula(value), ccCode, grid) : value;
      forgetCell(id, field);
      // Written over again with what it holds already: nothing to change after all.
      if (stored === li[field]) {
        const had = changes.get(id);
        if (had) delete had[field];
        return;
      }
      changes.set(id, { ...changes.get(id), [field]: stored });
      before.set(id, { ...before.get(id), [field]: li[field] });
    };
    const account = accountOfLine.get(line);
    if (!account) return;
    const own = linesOf(account).map((l) => l.id);
    const written = new Set<string>();
    const create: { accountId: string; description: string; expression: string }[] = [];
    const start = own.indexOf(line);
    for (let r = 0; r < rows.length; r++) {
      const id = own[start + r];
      if (id) {
        for (let c = 0; c < rows[r].length; c++) {
          const field = RANGE_COLS[col + c];
          if (!field) break;
          written.add(`${id}:${field}`);
          put(id, field, rows[r][c].trim());
        }
        continue;
      }
      // Past the account's last line: a new line at its end, as typing in its blank row makes.
      const made = { description: "", expression: "" };
      for (let c = 0; c < rows[r].length; c++) {
        const field = RANGE_COLS[col + c];
        if (!field) break;
        const v = rows[r][c].trim();
        made[field] = field === "expression" ? toStored(normalizeFormula(v), ccCode, grid) : v;
      }
      if (made.description || made.expression) create.push({ accountId: account.id, ...made });
    }
    if (from)
      for (const id of from.lines)
        for (const field of RANGE_COLS.slice(from.left, from.right + 1))
          if (!written.has(`${id}:${field}`)) put(id, field, "");

    const lines = [...changes].flatMap(([id, fields]) =>
      Object.keys(fields).length ? [{ id, ...fields }] : [],
    );
    if (lines.length === 0 && create.length === 0) return;
    const madeOf = (data: unknown) => (data as { created: LineItem[] }).created;
    await api(
      `/api/budgets/${budgetId}/cells`,
      "POST",
      { lines, create },
      (b, data) =>
        madeOf(data).reduce(
          (acc, li) => withLine(acc, account.id, li),
          lines.reduce<Budget>((acc, { id, ...fields }) => withLineFields(acc, id, fields), b),
        ),
      // One ⌘Z for the whole paste: the cells written back and the lines made deleted.
      (data) => {
        const made = madeOf(data);
        const order = [...own, ...made.map((m) => m.id)];
        const steps: UndoStep[] = [];
        if (lines.length)
          steps.push({
            kind: "fields",
            steps: lines.map(({ id, ...after }) => ({
              url: liUrl(id),
              before: before.get(id) ?? {},
              after,
            })),
          });
        if (made.length)
          steps.push({
            kind: "lines",
            created: true,
            lines: made.map((m) => ({
              accountId: account.id,
              lineId: m.id,
              body: { description: m.description, expression: m.expression },
            })),
            orders: [{ accountId: account.id, ids: order }],
          });
        record(steps.length === 1 ? steps[0] : { kind: "group", steps });
      },
    );
  }

  /**
   * Copied rows pasted with the caret on a line: written over it and the lines below it in its
   * account, the rest added at the account's end. With the caret on the account's own row, all
   * are added at the end. One ⌘Z puts back what was written over and deletes what was made.
   */
  function pasteRows(ids: string[], accountId: string | null, lineId: string | null) {
    if (!accountId) return;
    const was = new Map(
      (cc.accounts.find((a) => a.id === accountId)?.lineItems ?? []).map((l) => [l.id, l]),
    );
    return api(
      `/api/budgets/${budgetId}/cost-centers/${cc.id}/paste`,
      "POST",
      { accountId, lineItemIds: ids, ...(lineId && { overwriteFrom: lineId }) },
      // Only this sheet's accounts are taken from the answer.
      (b, data) =>
        withSheet(b, cc.id, (sheet) => ({ ...sheet, accounts: (data as BudgetCC).accounts })),
      (data) => {
        const { accounts, pasted } = data as BudgetCC & {
          pasted: { overwritten: string[]; created: string[] };
        };
        const now = accounts.find((a) => a.id === accountId)?.lineItems ?? [];
        const after = new Map(now.map((l) => [l.id, l]));
        const order = now.map((l) => l.id);
        const steps: UndoStep[] = [];
        if (pasted.overwritten.length)
          steps.push({
            kind: "fields",
            steps: pasted.overwritten.flatMap((id) => {
              const before = was.get(id);
              const to = after.get(id);
              return before && to
                ? [
                    {
                      url: liUrl(id),
                      before: { description: before.description, expression: before.expression },
                      after: { description: to.description, expression: to.expression },
                    },
                  ]
                : [];
            }),
          });
        const made = pasted.created.flatMap((id) => {
          const li = after.get(id);
          return li
            ? [
                {
                  accountId,
                  lineId: id,
                  body: { description: li.description, expression: li.expression },
                },
              ]
            : [];
        });
        if (made.length)
          steps.push({
            kind: "lines",
            created: true,
            lines: made,
            orders: [{ accountId, ids: order }],
          });
        if (steps.length) record(steps.length === 1 ? steps[0] : { kind: "group", steps });
      },
    );
  }

  /** Delete on rows or a block of cells: emptied in one write, one ⌘Z, as a paste is sent. */
  async function clearCells(lines: string[], left: number, right: number) {
    const fields = RANGE_COLS.slice(left, right + 1);
    const writes = lines.flatMap((id) => {
      const li = lineById.get(id);
      if (!li) return [];
      const before: Partial<Record<(typeof RANGE_COLS)[number], string>> = {};
      const after: Partial<Record<(typeof RANGE_COLS)[number], string>> = {};
      for (const f of fields) {
        forgetCell(id, f);
        if (li[f] === "") continue;
        before[f] = li[f];
        after[f] = "";
      }
      return Object.keys(after).length ? [{ id, before, after }] : [];
    });
    if (writes.length === 0) return;
    const body = { lines: writes.map(({ id, after }) => ({ id, ...after })) };
    await api(
      `/api/budgets/${budgetId}/cells`,
      "POST",
      body,
      (b) => body.lines.reduce<Budget>((acc, { id, ...f }) => withLineFields(acc, id, f), b),
      () =>
        record({
          kind: "fields",
          steps: writes.map(({ id, before, after }) => ({ url: liUrl(id), before, after })),
        }),
    );
  }

  // Rows chosen to act on: those selected whole (by their numbers, or a block across the row).
  // An account's own row is never one of them: rows act on lines (it is copied with them only
  // as the whole account, `blockIsAccount`).
  const rowsChosen = (): string[] => range.rows.filter((id) => !isHeaderKey(id));

  /** Rows onto the page's clipboard. Cut: the next paste moves them there instead. */
  function copyRows(ids: string[], cut: boolean) {
    if (ids.length === 0) return;
    setHeldCells(null);
    onCopy({ kind: "rows", ids, label: String(ids.length), cut });
    // Let go of the choice, so the bar turns to what was copied and how to paste it.
    range.clear();
  }

  async function removeRows(ids: string[]) {
    // No question first: one ⌘Z brings them all back, as a single row's delete does.
    if (ids.length === 0) return;
    range.clear();
    // One write for them all, and one ⌘Z (use-undo.ts) that makes them all again, in one write,
    // where they stood.
    const lines = ids.flatMap((id) => {
      const account = cc.accounts.find((a) => a.lineItems.some((l) => l.id === id));
      const li = account?.lineItems.find((l) => l.id === id);
      return account && li
        ? [
            {
              accountId: account.id,
              lineId: id,
              body: { description: li.description, expression: li.expression },
            },
          ]
        : [];
    });
    const orders = [...new Set(lines.map((l) => l.accountId))].map((accountId) => ({
      accountId,
      ids: (cc.accounts.find((a) => a.id === accountId)?.lineItems ?? []).map((l) => l.id),
    }));
    await api(
      `/api/budgets/${budgetId}/lines/delete`,
      "POST",
      { ids },
      (b) => ids.reduce((acc, id) => withoutLine(acc, id), b),
      () => record({ kind: "lines", created: false, lines, orders }),
    );
  }

  // The sum of the block's Belopp cells, for the line beside the formula bar.
  const rangeSum =
    blockIsRows || (range.multi && range.rect && range.rect.right >= 1)
      ? (blockIsRows ? range.rows : range.lines).reduce(
          (sum, id) => sum + (ev.lineItems[id] ?? 0),
          0,
        )
      : null;
  const rangeStatus = range.multi && (
    <span className="shrink-0 px-3 py-1.5 text-xs tabular-nums text-muted">
      {rangeSum !== null && <>{t("rangeSum", { sum: fmt(rangeSum) })} - </>}
      {t("rangeCount", { count: range.count })}
    </span>
  );

  useSheetClipboard({
    sheetRef,
    // Read when a key arrives: the document listener outlives any one render.
    isEditing: () => cellEdit.className.includes("is-editing"),
    copyRange,
    // ⌘C on the one selected cell (after a block and ticked rows).
    copyCell,
    // ⌘X: the rows chosen, else the cells selected.
    cutRows: () => {
      const ids = rowsChosen();
      if (!isAdmin) return false;
      if (ids.length === 0) return cutCellsHere();
      copyRows(ids, true);
      return true;
    },
    clip,
    onCopy,
    canPaste: isAdmin,
    onPaste: (c, accountId, lineId) =>
      // Cut rows move: onto the end of this account, wherever they were in the budget (the
      // reorder route moves a row it is handed from another account). The clip is then spent.
      c.kind === "rows" && c.cut && accountId
        ? (() => {
            const own = (cc.accounts.find((a) => a.id === accountId)?.lineItems ?? [])
              .map((l) => l.id)
              .filter((id) => !c.ids.includes(id));
            const ids = [...own, ...c.ids];
            return api(
              `/api/budget-accounts/${accountId}/line-items/reorder`,
              "POST",
              { orderedIds: ids },
              (b) => withLineOrder(b, accountId, ids),
              () => onCopy(null),
            );
          })()
        : c.kind === "rows"
          ? pasteRows(c.ids, accountId, lineId)
          : // Only this sheet's accounts are taken from the answer.
            api(
              `/api/budgets/${budgetId}/cost-centers/${cc.id}/paste`,
              "POST",
              { accountIds: c.ids, ...(c.lineIds && { accountLineIds: c.lineIds }) },
              (b, data) =>
                withSheet(b, cc.id, (sheet) => ({
                  ...sheet,
                  accounts: (data as BudgetCC).accounts,
                })),
            ),
    notify,
    t,
  });

  // The cell keys' reach into the block and what is chosen (use-cell-edit.ts), kept current.
  useEffect(() => {
    rangeKeys.current = {
      extend: range.extend,
      // Escape drops the block first, then what is copied or cut (its frame), as in a
      // spreadsheet.
      collapse: () => {
        if (range.collapse()) return true;
        if (accountPick) {
          setAccountPick(null);
          return true;
        }
        if (!heldCells && !clip) return false;
        setHeldCells(null);
        if (clip) onCopy(null);
        return true;
      },
      // Delete empties, as in a spreadsheet: the rows chosen keep their place with Beskrivning
      // and Belopp emptied, a block of cells is emptied. Removing rows is Ta bort in the bar.
      remove: () => {
        if (!isAdmin) return false;
        const rows = rowsChosen();
        if (rows.length > 0) {
          void clearCells(rows, 0, RANGE_COLS.length - 1);
          return true;
        }
        if (!range.multi || !range.rect) return false;
        void clearCells(range.lines, range.rect.left, range.rect.right);
        return true;
      },
    };
  });

  const sheetProps = cellEdit;
  const chosen = rowsChosen();
  // Rows cut and waiting for a paste, drawn faded where they still are.
  const cutIds = new Set(clip?.kind === "rows" && clip.cut ? clip.ids : []);
  // Rows copied or cut, in runs of neighbours as drawn, each framed (sheet-section.tsx).
  const heldIds = new Set(clip?.kind === "rows" ? clip.ids : []);
  const heldRuns: string[][] = [];
  {
    let run: string[] = [];
    for (const id of lineOrder) {
      if (heldIds.has(id)) run.push(id);
      else if (run.length) {
        heldRuns.push(run);
        run = [];
      }
    }
    if (run.length) heldRuns.push(run);
  }
  // Accounts copied, framed from the name on their own row to the Belopp of their last line.
  // The accounts picked, as drawn (Intäkter, then Kostnader), from the one first picked to the last.
  const accountOrder = [...income, ...cost];
  const chosenAccounts = (() => {
    if (!accountPick) return [];
    const i = accountOrder.findIndex((a) => a.id === accountPick.from);
    const j = accountOrder.findIndex((a) => a.id === accountPick.to);
    if (i < 0 || j < 0) return [];
    return accountOrder.slice(Math.min(i, j), Math.max(i, j) + 1);
  })();

  /** The accounts picked onto the page's clipboard, number and lines: ⌘V in a sheet adds them. */
  function copyAccounts() {
    if (chosenAccounts.length === 0) return;
    onCopy({
      kind: "accounts",
      ids: chosenAccounts.map((a) => a.id),
      label: chosenAccounts[0].accountCode,
    });
    setHeldCells(null);
    setAccountPick(null);
  }

  // With only some of its lines copied, the frame ends at the last of those.
  const heldAccounts =
    clip?.kind === "accounts"
      ? cc.accounts
          .filter((a) => clip.ids.includes(a.id))
          .map((a) => {
            const lines = linesOf(a).filter((l) => !clip.lineIds || clip.lineIds.includes(l.id));
            return { id: a.id, lastLine: lines.at(-1)?.id ?? null };
          })
      : [];

  /** A press on a line's number: a click selects the row (Shift: the rows to it, ⌘: adds it), a drag moves it. */
  function pressRowNumber(e: React.PointerEvent, li: LineItem) {
    if (e.button !== 0) return;
    // ⌘-click (Ctrl elsewhere): the row joins the selection, or leaves it, and nothing is dragged.
    if (e.metaKey || e.ctrlKey) {
      e.preventDefault();
      range.toggleRow(li.id);
      return;
    }
    const shift = e.shiftKey;
    const select = () => range.selectRows(li.id, shift);
    if (!isAdmin) {
      e.preventDefault();
      select();
      return;
    }
    startLineDrag(e, li, select);
  }

  /** A press on an account's own number: picks the account (Shift: the accounts to it), and a drag picks those it passes over. */
  function pressAccountNumber(e: React.PointerEvent, account: Account) {
    if (e.button !== 0) return;
    e.preventDefault();
    // ⌘-click: the account's own row joins the rows selected (or leaves), as a line's does, so
    // an account is copied with just the lines picked beside it.
    if (e.metaKey || e.ctrlKey) {
      setAccountPick(null);
      range.toggleRow(headerKey(account.id));
      return;
    }
    range.clear();
    const from = e.shiftKey && accountPick ? accountPick.from : account.id;
    setAccountPick({ from, to: account.id });
    // Dragged on, over other accounts' rows: they join, as rows do under a dragged row number.
    const move = (ev: PointerEvent) => {
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      const over =
        el?.closest<HTMLElement>("tr[data-account-row]")?.dataset.accountRow ??
        el?.closest<HTMLElement>("tr[data-line]")?.dataset.account;
      if (over && sheetRef.current?.contains(el))
        setAccountPick((p) => (p && p.to !== over ? { ...p, to: over } : p));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  // What the drop below calls once a row has moved, kept current here since the drag's options are read when the
  // drop comes: ends a copy (or cut) that holds the row.
  const letGoOfCopy = useRef<(lineId: string, order: string[]) => void>(() => {});
  useEffect(() => {
    // `order` is the account's lines as the row now stands among them. A copy ends when one
    // of its rows moves, or another row is slotted in between them: either way it is no longer
    // the rows that were copied, as they sat together.
    letGoOfCopy.current = (lineId, order) => {
      const changes = (held: string[]) => held.includes(lineId) || landsInside(order, lineId, held);
      if (clip?.kind === "rows" && changes(clip.ids)) onCopy(null);
      if (heldCells && changes(heldCells.lines)) setHeldCells(null);
      // A selected block is bounded by its corner rows, so a row slotted in would join it.
      range.clear();
    };
  });

  const lineDrag = useRowDrag<LineDrag>({
    begin: (id) => {
      const ids: Record<string, string[]> = {};
      for (const a of cc.accounts) ids[a.id] = linesOf(a).map((l) => l.id);
      const from = cc.accounts.find((a) => ids[a.id].includes(id))?.id ?? "";
      setPlacement(ids);
      return { id, fromAccountId: from, accountId: from, ids, before: ids };
    },
    over: (d, under, pointer) => {
      const over = under?.closest<HTMLElement>("tr[data-line]");
      const zone = under?.closest<HTMLElement>("tbody[data-drop-account]")?.dataset.dropAccount;
      if (over) {
        if (over.dataset.line !== d.id && over.dataset.account)
          place(d, over.dataset.account, over.dataset.line!, belowMiddle(over, pointer.y));
      } else if (zone) {
        // The rest of an account is split at its rows: the heading takes the row first, and
        // anything under the rows (Summa, the new-row line) takes it last. The boundary
        // between two accounts is then the same going up as going down.
        const head = under?.closest("tr[data-account-row]");
        const first = (d.ids[zone] ?? []).find((x) => x !== d.id) ?? null;
        place(d, zone, head ? first : null, false);
      }
    },
    // Saved once on drop, in one request even across accounts (see the reorder endpoint).
    // `withLineOrder` is the route's own rule; the placement stands until the save lands.
    drop: (d) => {
      const to = d.accountId;
      const moved = to !== d.fromAccountId || d.ids[to].join() !== d.before[to].join();
      if (!moved) {
        setPlacement(null);
        return;
      }
      // A copy is of rows where they stood: moving one of them ends it (and its frame), so a
      // copy never comes to span two accounts. The same for cells on the row moved.
      letGoOfCopy.current(d.id, d.ids[to]);
      const ids = d.ids[to];
      api(`/api/budget-accounts/${to}/line-items/reorder`, "POST", { orderedIds: ids }, (b) =>
        withLineOrder(b, to, ids),
      ).then(() => setPlacement(null));
    },
    cancel: () => setPlacement(null),
    // Held inside the accounts, headings and Summa included. Not inside the line rows: with
    // every account above it empty, the dragged row is the first line row and could not rise.
    bounds: () => {
      const zones = sheetRef.current?.querySelectorAll<HTMLElement>("tbody[data-drop-account]");
      if (!zones || zones.length === 0) return null;
      return {
        top: zones[0].getBoundingClientRect().top,
        bottom: zones[zones.length - 1].getBoundingClientRect().bottom,
      };
    },
  });
  const draggingLineId = lineDrag.draggingId;

  /** `onClick`: what a press that never moved far enough to lift the row does instead. */
  function startLineDrag(e: React.PointerEvent, li: LineItem, onClick?: () => void) {
    if (!isAdmin) return;
    lineDrag.start(e, li.id, onClick);
  }

  // An account only the other side has, shown read-only so the gap is visible.

  // One section as a card; the whole card is a drop zone that flips a dropped account's kind.

  // Drawn twice (phone strip, md tiles) from one place so they cannot disagree.
  const summary = [
    {
      label: t("totalIncome"),
      ref: "#intäkter",
      v: totals.income,
      a: compareTotals.income,
      incomeLike: true,
      signed: false,
      impact: undefined as number | undefined,
    },
    {
      label: t("totalCosts"),
      ref: "#kostnader",
      v: totals.cost,
      a: compareTotals.cost,
      incomeLike: false,
      signed: false,
      impact: undefined as number | undefined,
    },
    {
      label: tRam("result"),
      ref: "#resultat",
      v: totals.result,
      a: compareTotals.result,
      signed: true,
      incomeLike: true,
      impact: changeImpact,
    },
  ];

  // Comments go on a locked budget too (the routes skip the write lock), so neither waits on isAdmin.
  async function postComment(target: CommentTarget, body: string) {
    if (target.kind === "account")
      return api(`/api/budget-accounts/${target.accountId}/comments`, "POST", { body }, (b, data) =>
        withComment(b, { accountId: target.accountId }, { ...(data as Comment), field: null }),
      );
    return api(
      `/api/budget-line-items/${target.lineId}/comments`,
      "POST",
      { body, field: target.field },
      (b, data) => withComment(b, { lineId: target.lineId }, data as Comment),
    );
  }
  function deleteComment(id: string) {
    return api(`/api/budget-comments/${id}`, "DELETE", undefined, (b) => withoutComment(b, id));
  }

  /**
   * Right-click on a cell that takes comments (an account's number, a line's Beskrivning or
   * Belopp): comment on it. While a cell is being written in, the browser's own menu stays (paste,
   * spelling). Someone who may only read gets the menu only where there is something to read.
   */
  function onContextMenu(e: React.MouseEvent) {
    const el = e.target as HTMLElement;
    if (
      el.matches("input, textarea") &&
      el === document.activeElement &&
      cellEdit.className.includes("is-editing")
    )
      return;
    const td = el.closest<HTMLElement>("td[data-comment-field]");
    const tr = td?.closest<HTMLElement>("tr[data-line], tr[data-account-row]");
    if (!td || !tr) return;
    const target: CommentTarget = tr.dataset.line
      ? { kind: "line", lineId: tr.dataset.line, field: td.dataset.commentField as CommentField }
      : { kind: "account", accountId: tr.dataset.accountRow! };
    const count = commentsAt(cc, target).length;
    if (count === 0 && !canComment) return;
    e.preventDefault();
    comments.close();
    setMenu({
      x: e.clientX,
      y: e.clientY,
      anchor: td,
      items: [{ target, label: count ? t("cellComments", { count }) : t("commentCell") }],
    });
  }

  // Gathered once for the four nested table levels (see ./sheet-context).
  const sheet: SheetValue = {
    cc,
    record,
    ccCode,
    budgetId,
    columns,
    grid,
    ev,
    accounts,
    adjustments,
    compare,
    showCompare,
    isAdmin,
    canComment,
    userId,
    renderCell,
    renderFormula,
    api,
    date,
    narrow,
    gut,
    del,
    actualPad,
    totalCols,
    gutWidth: GUT_W,
    actionsWidth: ACT_W,
    staticWidth,
    t,
    tCol,
    tRam,
    tChanges,
    tAlloc,
    tBook,
    tLedger,
    income,
    cost,
    totals,
    compareTotals,
    compareAccounts,
    changeImpact,
    badAccount,
    badLine,
    liUrl,
    accountOptionsFor,
    pressRowNumber,
    pressAccountNumber,
    accountPicked: (id: string) => chosenAccounts.some((a) => a.id === id),
    pickedAccounts: chosenAccounts.length
      ? {
          first: chosenAccounts[0].id,
          last: chosenAccounts[chosenAccounts.length - 1].id,
          lastLine: linesOf(chosenAccounts[chosenAccounts.length - 1]).at(-1)?.id ?? null,
        }
      : null,
    draggingLineId,
    linesOf,
    liftRef: lineDrag.rowRef,
    draft,
    setDraft,
    createLine,
    createAccount,
    comments,
    thread: comments.thread,
    commentDraft,
    postComment,
    deleteComment,
    range,
    editing: cellEdit.className.includes("is-editing"),
    cutIds,
    heldRuns,
    heldAccounts,
    heldCells,
  };

  return (
    <SheetProvider value={sheet}>
      {/* The mouse handlers delegate for the cells inside, which have their own keyboard
          (use-cell-edit.ts): the wrapper itself is not something to operate. */}
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
      <div
        ref={sheetRef}
        {...sheetProps}
        onContextMenu={onContextMenu}
        onPasteCapture={onPasteCapture}
        onMouseDown={(e) => {
          // Anything but an account's number lets go of picked accounts (portals aside).
          const el = e.target as Element;
          if (sheetRef.current?.contains(el) && !el.closest("[data-account-number]"))
            setAccountPick(null);
          range.onMouseDown(e);
        }}
        onFocus={(e) => {
          if (sheetRef.current?.contains(e.target as Node)) setAccountPick(null);
          range.onFocus(e);
        }}
      >
        {/* Sticky layer is square and opaque; the rounded card inside it would show rows through its corner arcs. */}
        <div className="sticky top-app-bar z-10 bg-canvas md:hidden">
          <div className="rounded-panel border border-border bg-background">
            <button
              type="button"
              onClick={() => setSummaryOpen((o) => !o)}
              aria-expanded={summaryOpen}
              className="grid w-full grid-cols-3 gap-2 px-3 py-2 text-left"
            >
              {summary.map((s) => (
                <span key={s.label} className="min-w-0">
                  <span className="block truncate text-xs text-muted">{s.label}</span>
                  <span
                    className={cn(
                      "block truncate text-sm font-semibold tabular-nums",
                      s.signed && (s.v < 0 ? "text-danger" : s.v > 0 ? "text-success" : ""),
                    )}
                  >
                    {s.signed ? fmtSigned(s.v) : fmt(s.v)}
                  </span>
                </span>
              ))}
            </button>

            {summaryOpen && (
              <div className="space-y-2 border-t border-border px-3 py-2 text-xs">
                {compare &&
                  summary.map((s) => (
                    <div key={s.label} className="space-y-1">
                      <p className="flex items-baseline justify-between gap-2 text-muted">
                        <span className="truncate">
                          {s.label} - {compare.label}
                        </span>
                        <span className="shrink-0 tabular-nums text-foreground">{fmt(s.a)}</span>
                      </p>
                      <p className="flex items-baseline justify-between gap-2 text-muted">
                        <span className="truncate">
                          {s.label} - {tGroup("diff")}
                        </span>
                        <span
                          className={cn(
                            "shrink-0 tabular-nums",
                            diffClass(compareDiff(s.v, s.a, compare.vsActuals), s.incomeLike),
                          )}
                        >
                          {fmtSigned(compareDiff(s.v, s.a, compare.vsActuals))}
                        </span>
                      </p>
                    </div>
                  ))}
                {changeImpact !== 0 && (
                  <p className="flex items-baseline justify-between gap-2 text-muted">
                    <span className="truncate">{tRam("changes")}</span>
                    <span className="shrink-0 tabular-nums">
                      <span className={diffClass(changeImpact, true)}>
                        {fmtSigned(changeImpact)}
                      </span>
                      <span className="ml-2 text-muted">
                        {t("originallyLabel")}{" "}
                        <span className="tabular-nums text-foreground">
                          {fmtSigned(totals.result - changeImpact)}
                        </span>
                      </span>
                    </span>
                  </p>
                )}

                {compare && (
                  <button
                    type="button"
                    onClick={() => setCompareOnPhone((v) => !v)}
                    className="text-xs font-medium link"
                  >
                    {compareOnPhone ? t("hideCompareColumns") : t("showCompareColumns")}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* What can be done with the chosen rows (ticked, or a block of cells over several rows),
            floating at the foot of the screen as on the other lists (SelectionBar). Accounts win,
            as a copy takes them over their rows; they can only be copied from here. */}
        {isAdmin &&
          (chosenAccounts.length > 0 || blockAccount ? (
            // Accounts picked by their numbers, or a block over one account's row and all its
            // lines: whole accounts, copied as such.
            <SelectionBar
              count={blockAccount ? 1 : chosenAccounts.length}
              label={(count) =>
                blockAccount
                  ? t("markedAccountRows", { count: blockAccount.lines.length })
                  : t("markedAccounts", { count })
              }
            >
              <Button onClick={blockAccount ? copyRange : copyAccounts} title="⌘/Ctrl+C">
                <IconCopy className="size-4" />
                {t("copyMarked")}
              </Button>
            </SelectionBar>
          ) : chosen.length === 0 && range.multi ? (
            // A block of cells, not whole rows: only its values can be taken.
            <SelectionBar count={range.count} label={(count) => t("markedCells", { count })}>
              <Button onClick={copyRange} title="⌘/Ctrl+C">
                <IconCopy className="size-4" />
                {t("copyMarked")}
              </Button>
            </SelectionBar>
          ) : chosen.length === 0 && heldCells ? (
            // What is copied or cut, said in a word, and the key that pastes it. The frame on the
            // sheet shows where it is; a cut is also faded there.
            <SelectionBar
              count={heldCells.lines.length * (heldCells.right - heldCells.left + 1)}
              label={(count) => t("heldCells", { count })}
            >
              <PasteKey label={t("paste")} />
              <Button variant="quiet" onClick={() => setHeldCells(null)}>
                {t("clearClipboard")}
              </Button>
            </SelectionBar>
          ) : chosen.length === 0 && clip ? (
            // Nothing chosen and something copied: what the page's clipboard holds, in a word, and
            // the key that pastes it, in the same place the actions were.
            <SelectionBar
              count={clip.ids.length}
              label={(count) =>
                clip.kind === "rows"
                  ? t("heldRows", { count })
                  : clip.lineIds
                    ? t("heldAccountRows", { count: clip.lineIds.length })
                    : t("heldAccounts", { count })
              }
            >
              <PasteKey label={t("paste")} />
              <Button variant="quiet" onClick={() => onCopy(null)}>
                {t("clearClipboard")}
              </Button>
            </SelectionBar>
          ) : (
            <SelectionBar count={chosen.length} label={(count) => t("markedRows", { count })}>
              <Button variant="secondary" onClick={() => removeRows(chosen)}>
                <IconTrash className="size-4" />
                {t("removeMarked")}
              </Button>
              <Button variant="secondary" onClick={() => copyRows(chosen, true)} title="⌘/Ctrl+X">
                <IconScissors className="size-4" />
                {t("cutMarked")}
              </Button>
              <Button onClick={() => copyRows(chosen, false)} title="⌘/Ctrl+C">
                <IconCopy className="size-4" />
                {t("copyMarked")}
              </Button>
            </SelectionBar>
          ))}

        {/* The totals, the formula bar and the column header as one card, pinned so they stay
            in view while the rows scroll: under what the shell pins (--sticky-top, app-shell.tsx: the section band,
            h-11 and its border) while the page scrolls, at the top of the sheet pane from lg,
            where the pane scrolls on its own (budget-client.tsx). The grid hangs straight from
            it (SheetGrid), so no gap below (mb-0 over space-y-4). Above it an opaque strip keeps
            rows from showing between band and card, needless from lg, where nothing is above
            the pane's top and the card then lines up with the sidebar. z-[15]: above a selected
            cell (z-index 10, `.budget-grid` in globals.css), below the band (z-20). Cells moved
            to are kept out from under it (`revealCell` in use-cell-edit.ts). */}
        <div
          data-sheet-head
          className="sticky z-[15] -mt-2 mb-0 hidden bg-canvas pt-2 md:top-(--sticky-top) md:block lg:top-0 lg:mt-0 lg:pt-0"
        >
          <div className="grid-lines budget-grid overflow-clip rounded-t-panel border border-b-0 border-border bg-background">
            <div className="grid grid-cols-3 divide-x divide-border">
              {summary.map((s) => (
                <div key={s.label} className="min-w-0 px-4 py-2.5">
                  <p className="flex items-baseline justify-between gap-3">
                    <span className="flex min-w-0 items-baseline gap-2">
                      <span className="truncate text-xs text-muted">
                        {compare ? tGroup("ofBudget", { label: s.label }) : s.label}
                      </span>
                      {/* What a formula writes to read this figure, as the gutter shows a row's #. */}
                      <span className="shrink-0 font-mono text-[11px] text-muted/70">{s.ref}</span>
                    </span>
                    <span
                      className={cn(
                        "shrink-0 text-base font-semibold tabular-nums",
                        s.signed && (s.v < 0 ? "text-danger" : s.v > 0 ? "text-success" : ""),
                      )}
                    >
                      {s.signed ? fmtSigned(s.v) : fmt(s.v)}
                    </span>
                  </p>
                  {/* Name each figure, or they run together. */}
                  {compare && (
                    <>
                      <p className="mt-1 flex items-baseline justify-between gap-3 text-xs">
                        <span className="truncate text-muted">{compare.label}</span>
                        <span className="shrink-0 tabular-nums">{fmt(s.a)}</span>
                      </p>
                      <p
                        className="mt-1 flex items-baseline justify-between gap-3 text-xs"
                        title={tGroup(compare.vsActuals ? "diffHintActuals" : "diffHintBudget")}
                      >
                        <span className="truncate text-muted">{tGroup("diff")}</span>
                        <span
                          className={cn(
                            "shrink-0 tabular-nums",
                            diffClass(compareDiff(s.v, s.a, compare.vsActuals), s.incomeLike),
                          )}
                        >
                          {fmtSigned(compareDiff(s.v, s.a, compare.vsActuals))}
                        </span>
                      </p>
                    </>
                  )}

                  {s.impact !== undefined && s.impact !== 0 && (
                    <p className="mt-1 flex items-baseline justify-between gap-3 text-xs text-muted">
                      <span className="truncate">{tRam("changes")}</span>
                      <span className="shrink-0 tabular-nums">
                        <span className={diffClass(s.impact, true)}>{fmtSigned(s.impact)}</span>
                        <span className="ml-2">
                          {t("originallyLabel")}{" "}
                          <span className="text-foreground">{fmtSigned(s.v - s.impact)}</span>
                        </span>
                      </span>
                    </p>
                  )}
                </div>
              ))}
            </div>
            {(formulaBar || rangeStatus) && (
              <div className="flex items-center border-t border-border">
                <div className="min-w-0 flex-1">{formulaBar}</div>
                {rangeStatus && <span className="border-l border-border">{rangeStatus}</span>}
              </div>
            )}
            <div className="border-t border-border">
              <SheetHeader />
            </div>
          </div>
        </div>

        <SheetGrid
          sections={[
            {
              kind: "INCOME",
              label: tRam("income"),
              accts: income,
              ghosts: ghostAccounts.filter((a) => a.kind === "INCOME"),
            },
            {
              kind: "COST",
              label: tRam("costs"),
              accts: cost,
              ghosts: ghostAccounts.filter((a) => a.kind === "COST"),
            },
          ]}
        />
      </div>
      <CommentPanel />
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} label={t("comments")} onClose={() => setMenu(null)}>
          {menu.items.map((it) => (
            <MenuItem
              key={targetKey(it.target)}
              onClick={() => comments.open(it.target, menu.anchor)}
            >
              <IconComment className="size-4 text-muted" />
              {it.label}
            </MenuItem>
          ))}
        </ContextMenu>
      )}
    </SheetProvider>
  );
}

/** How to paste what is copied: the paste icon, the word and its key, as a hint (not a button). */
function PasteKey({ label }: { label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-sm text-muted">
      <IconPaste className="size-4" />
      {label}
      <Kbd mod k="V" />
    </span>
  );
}
