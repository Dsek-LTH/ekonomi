// The per-cost-centre sheet: income / costs as two rounded cards, each an
// account → line-items → Summa table. Owns the drag-reclassify + row-reorder
// drag handlers and the per-sheet drafts; the select/edit behaviour comes from
// useCellEdit, and the cell renderers and `api` from the budget client.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { effectiveKind, type AccountKind } from "@/lib/budget";
import { lineKeys, sheetTotals, ZERO_TOTALS, type JoinedAccount, type JoinedSheet } from "@/lib/budget/compare";
import { type BudgetGrid, type ColumnDef } from "@/lib/budget/grid";
import { useFormat } from "@/lib/ui/use-format";
import { usePhone } from "@/lib/ui/media";
import { cn } from "@/lib/ui/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { IconButton } from "@/components/ui/icon-button";
import { IconComment, IconElbow, IconTrash } from "@/components/ui/icons";
import { StatRow } from "./stat-row";
import { resultImpact } from "@/lib/budget/changes";

import { DragHandle, insideRect } from "@/components/ui/drag";
import { ccTotals, diffClass, fmt, fmtSigned, type AdjustmentRow } from "./budget-helpers";
import {
  withAccount,
  withComment,
  withLine,
  withLineOrder,
  withNewAccount,
  withoutAccount,
  withoutComment,
  withoutLine,
  withSheet,
} from "./patch-budget";
import { useCellEdit } from "./use-cell-edit";
import { useNotify } from "@/components/shell/notifications";
import type { AccountRecord } from "@/lib/domain/types";
import { Combobox } from "@/components/ui/combobox";
import type { Account, BudgetCC, BudgetClip, Comment, Evaluated, LineItem, Draft, CellFn, FormulaFn, ApiFn } from "./budget-types";

/** This sheet, joined against the one side it is being compared with. */
export interface SheetCompare { label: string; sheet: JoinedSheet }

export function CostCenterSheet(props: {
  cc: BudgetCC; ccCode: string; ev: Evaluated; grid: BudgetGrid; columns: ColumnDef[];
  compare: SheetCompare | null;
  isAdmin: boolean; canComment: boolean; userId: string;
  renderCell: CellFn; renderFormula: FormulaFn; api: ApiFn; budgetId: string;
  accounts: AccountRecord[];
  /** Editorial adjustments in force, by account id — see budget-helpers. */
  adjustments: Map<string, AdjustmentRow[]>;
  /** What has been copied, from this sheet or from any other. */
  clip: BudgetClip | null;
  onCopy: (clip: BudgetClip | null) => void;
}) {
  const { cc, ccCode, ev, grid, columns, compare, isAdmin, canComment, userId, renderCell, renderFormula, api, budgetId, accounts, adjustments, clip, onCopy } = props;
  const t = useTranslations("budget.sheet");
  const tCol = useTranslations("budget.col");
  const tRam = useTranslations("budget.rambudget");
  const tChanges = useTranslations("budget.changes");
  const tAlloc = useTranslations("allocation");
  const tBook = useTranslations("book");
  const tLedger = useTranslations("ledger");
  const { date } = useFormat();

  // Spreadsheet select/edit over this sheet's gated cells. Movement is native.
  const cellEdit = useCellEdit("space-y-4");
  const notify = useNotify();

  // Sheet-local UI state: which accounts have their comments expanded, and the
  // buffered drafts for the "+ new line" / "+ account" rows.
  const [openComments, setOpenComments] = useState<Set<string>>(new Set());
  const [commentDraft, setCommentDraft] = useState<Record<string, string>>({});
  const [newRow, setNewRow] = useState<Record<string, Draft>>({});

  const badLine = new Set(ev.badLineItems ?? []);
  // Accounts whose total is short a row that didn't resolve. The figure below
  // is still the sum of the rows that did — a sheet you can't read is no help
  // in finding the row to fix — so this is what says it is a partial one.
  const badAccount = new Set(ev.badAccounts ?? []);
  // The left margin: the row's A1 number and the box that picks the row out for
  // a copy, in one cell rather than a column each — a whole column of furniture
  // for a 16px square is a column the figures don't get.
  //
  // The box is centred in the cell and the number is laid over its left edge,
  // out of the flow, so that neither can push the other about: the boxes line
  // up straight down the sheet whatever the numbers beside them are doing, and
  // a row without a number keeps its box in the same place as the rest.
  // `table-fixed` sizes the column from the colgroup and never from what is in
  // it, so a 0px column whose cells still carry padding, a border and a tick box
  // does not collapse — it overflows into the column beside it. On a phone the
  // cell is emptied rather than squeezed.
  const gut = (n: number | undefined, box?: React.ReactNode) =>
    narrow ? (
      <td className="p-0" />
    ) : (
      <td className="relative select-none border-r border-border/60 px-1 align-middle">
        <span className="absolute inset-y-0 left-1 flex items-center font-mono text-[10px] leading-8 text-muted/50">
          {n ?? ""}
        </span>
        <span className="flex h-8 items-center justify-center">{box}</span>
      </td>
    );

  // Row delete. Revealed on row hover (like the drag grip) so a long sheet isn't
  // a column of bins — keyboard focus reveals it too, so it stays reachable
  // without a mouse.
  const del = (onClick: () => void, label: string) => (
    <IconButton tone="danger" reveal onClick={onClick} label={label}>
      <IconTrash className="size-4" />
    </IconButton>
  );

  const income = cc.accounts.filter((a) => effectiveKind(a.accountCode, a.kindOverride) === "INCOME");
  const cost = cc.accounts.filter((a) => effectiveKind(a.accountCode, a.kindOverride) === "COST");
  const totals = ccTotals(cc, ev);

  // How much of this sheet's result is editorial changes rather than what
  // was adopted. The totals above already contain them; this is what says so.
  const changeImpact = cc.accounts.reduce((sum, a) => {
    const net = (adjustments.get(a.id) ?? []).reduce((s, r) => s + r.amount, 0);
    return sum + resultImpact(effectiveKind(a.accountCode, a.kindOverride), net);
  }, 0);

  // Whatever is being compared against — the year's utfall or another budget
  // (see use-comparison.tsx) — shown as two extra, non-grid columns after
  // Belopp, on the account totals and on each row.
  //
  // The other side is looked up through the join, so what only it has is here
  // too: an account it budgets for that this sheet doesn't (`ghostAccounts`),
  // and rows inside a shared account that this one lacks. Those render read-only
  // and unbudgeted — the point of showing them is that the blank is the finding.
  // Below md the sheet has 361px of screen and 506px of fixed columns, so
  // something has to give. What gives is the chrome — see the widths below —
  // and the comparison, which adds another 200px and is the one thing here
  // somebody asked for rather than always needed.
  const narrow = usePhone();
  const [compareOnPhone, setCompareOnPhone] = useState(false);
  /** Whether the phone strip is showing what the tiles used to say underneath. */
  const [summaryOpen, setSummaryOpen] = useState(false);
  const showCompare = compare !== null && (!narrow || compareOnPhone);
  const compareTotals = compare ? sheetTotals(compare.sheet, 1) : ZERO_TOTALS;
  const compareAccounts = new Map((compare?.sheet.accounts ?? []).map((a) => [a.code, a]));
  const ownCodes = new Set(cc.accounts.map((a) => a.accountCode));
  // Only while the comparison's columns are showing: a ghost row is an account
  // the *other* side has, and its whole content is in those columns. Without
  // them it would be a row with a name and nothing else.
  const ghostAccounts = showCompare
    ? (compare?.sheet.accounts ?? []).filter((a) => !ownCodes.has(a.code))
    : [];
  // Two empty trailing cells to keep non-Summa rows aligned when they show.
  const actualPad = showCompare ? <><td className="border-l border-border/40" /><td /></> : null;

  // Column geometry. The table is: gutter + every column (+ compare + diff) + action.
  const totalCols = columns.length + 2 + (showCompare ? 2 : 0); // full-width spanners (comments)
  const liUrl = (id: string) => `/api/budget-line-items/${id}`;

  // Fixed widths; Beskrivning is left elastic so it fills the row. The table is
  // w-full, so it always fits its container with no horizontal scrollbar.
  // The action column holds a trash icon on every row, plus the comment toggle
  // (icon + count) on account rows — wide enough for both without wrapping.
  //
  // Two sets of them, because the desktop set came to 506px of fixed columns
  // and a phone has 361px of screen: Beskrivning — the column you actually read
  // — was collapsing to nothing and the sheet was something you dragged
  // sideways. Every pixel reclaimed below is chrome rather than content:
  //
  //   gutter  58 → 0    a row number and a drag grip. Dragging a row on a touch
  //                     screen, inside a table that is itself scrolling
  //                     sideways, is not a gesture anybody completes.
  //   konto  110 → 26   on an account row this holds the code; on a line row it
  //                     holds an elbow and the grip, and nothing else. 26px is
  //                     the elbow.
  //   belopp 260 → 110  260 is the width of "2 × TROJA_POLICY = 700". At 110 the
  //                     cell shows the 700 and keeps the equation for the tap
  //                     (see `compact` in use-budget-cells.tsx).
  //   action  78 → 40   one icon instead of two side by side.
  //
  // Which leaves ~185px for Beskrivning instead of nothing.
  const GUT_W = narrow ? 0 : 58, ACT_W = narrow ? 40 : 78;
  const staticWidth = (c: ColumnDef): number | undefined =>
    c.key === "beskrivning"
      ? undefined
      : c.key === "konto"
        ? (narrow ? 26 : 110)
        : (narrow ? 110 : 260);

  // One line-item cell, rendered per column.
  function lineCell(col: ColumnDef, li: LineItem, account: Account) {
    const k = col.key;
    if (k === "konto") return (
      // The account-number column, on a row that has no number of its own. What
      // it holds instead is the elbow: down out of the account above, right into
      // this row — the same mark the income screen puts on a product's variant,
      // and the same reading. The grip keeps the left of the cell; `ml-auto`
      // holds the elbow against the row it points at, whether or not the grip
      // is there to be seen.
      <td key={k} className="border-r border-border/60 p-0">
        <span className="flex items-center py-1.5 pl-1.5 pr-2">
          {isAdmin && (
            <DragHandle
              onPointerDown={(e) => startLineDrag(e, account, li)}
              className={cn(
                "flex items-center text-muted/30 hover:text-muted",
                draggingLineId === li.id && "text-muted opacity-100",
              )}
              title={t("dragToReorder")}
            />
          )}
          <IconElbow className="ml-auto size-3.5 shrink-0 text-muted/40" />
        </span>
      </td>
    );
    if (k === "beskrivning")
      return <td key={k} className="border-r border-border/60 p-0">{renderCell({ id: li.id, field: "description", actual: li.description, className: "pl-5 text-muted", placeholder: tCol("beskrivning"), url: liUrl(li.id), payload: (v) => ({ description: v }), gated: true })}</td>;
    const val = ev.lineItems[li.id];
    return <td key={k} className="border-r border-border/60 p-0 text-right">{renderFormula({ id: li.id, field: "expression", raw: li.expression, computed: val, sheet: ccCode, bad: badLine.has(li.id), placeholder: "0", url: liUrl(li.id), payload: (v) => ({ expression: v }), gated: true })}</td>;
  }

  const draft = (id: string): Draft => newRow[id] ?? { description: "", expression: "" };
  const setDraft = (id: string, patch: Partial<Draft>) =>
    setNewRow((m) => ({ ...m, [id]: { ...draft(id), ...patch } }));

  async function createLine(accountId: string) {
    const d = newRow[accountId];
    if (!d || (!d.description.trim() && !d.expression.trim())) return;
    // The route hands back the row it made, id and sort order and all, so the
    // sheet gains it from the answer instead of re-reading the whole budget to
    // find out that it has one more row than it had.
    const ok = await api(
      `/api/budget-accounts/${accountId}/line-items`,
      "POST",
      { description: d.description.trim(), expression: d.expression.trim() || "0" },
      (b, data) => withLine(b, accountId, data as LineItem),
    );
    if (ok) setNewRow((m) => { const n = { ...m }; delete n[accountId]; return n; });
  }

  // The live drag-reclassify target.
  const [dropKind, setDropKind] = useState<AccountKind | null>(null);

  // Accounts come from the synced chart, so a budget can only refer to accounts
  // the ledger actually reports on. Ones already on this sheet are filtered out
  // — `keep` is the row's own account, which has to stay in its own picker for
  // the value to resolve to a label.
  const used = new Set(cc.accounts.map((a) => a.accountCode));
  const accountOptionsFor = (keep?: string) =>
    accounts
      .filter((a) => (a.number === keep ? true : a.active && !used.has(a.number)))
      .map((a) => ({ value: a.number, label: `${a.number} · ${a.name}`, short: a.number }));
  const accountOptions = accountOptionsFor();

  async function createAccount(kind: AccountKind, code: string) {
    if (!code.trim()) return;
    // The name is resolved server-side from the chart — which is the reason the
    // new account is taken from the response rather than assembled here: this
    // side knows the code that was asked for, and the server knows what it is
    // called. It comes back with its (empty) rows and comments on it.
    await api(
      `/api/budgets/${budgetId}/cost-centers/${cc.id}/accounts`,
      "POST",
      { accountCode: code.trim(), kindOverride: kind },
      (b, data) => withNewAccount(b, cc.id, data as Account),
    );
  }

  // Dropping an account card flips its income/cost classification. Gated on the
  // "accountid" drag payload so it ignores line-row drags (which carry "lineid").
  const dropProps = (kind: AccountKind) => ({
    onDragOver: (e: React.DragEvent) => { if (!e.dataTransfer.types.includes("accountid")) return; e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (dropKind !== kind) setDropKind(kind); },
    onDragLeave: (e: React.DragEvent) => { if (insideRect(e)) return; setDropKind((k) => (k === kind ? null : k)); },
    onDrop: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes("accountid")) return;
      e.preventDefault();
      setDropKind(null);
      const id = e.dataTransfer.getData("accountId");
      // Only the override moves; the account keeps its rows, which the response
      // does not carry and this must not drop.
      if (id) {
        api(`/api/budget-accounts/${id}`, "PATCH", { kindOverride: kind }, (b, data) =>
          withAccount(b, id, (a) => ({ ...a, kindOverride: (data as Account).kindOverride })),
        );
      }
    },
  });

  /**
   * Reordering a line by hand — within its account, or onto another one.
   *
   * The row is lifted out and follows the pointer; the rows it passes snap into
   * the gap it left, one at a time, as the pointer crosses each halfway mark.
   * The same drag as the voucher table's (components/voucher-editor.tsx) — a
   * line drawn between two rows says where a row would land, which is not the
   * same as reading the sheet you are about to save.
   *
   * A pointer drag and not HTML5's, which reports what you are over rather than
   * where you are, and so can only ever snap. Reclassifying a whole account by
   * dropping it on the other section still is HTML5: that one is a thing landing
   * on another thing, which is exactly what it is for.
   *
   * Where a row lands is an account and a place in it at once, so a row can be
   * carried across the sheet and not only up and down its own account. Which is
   * why the geometry here is measured rather than counted in row heights: an
   * account's heading, its Summa and its new-row line all stand between one
   * account's rows and the next, and none of them is a row height.
   */
  interface LineDrag {
    id: string;
    /** The account it was picked up from, and the one it is over now. */
    fromAccountId: string;
    accountId: string;
    /** Every account's rows as placed — the ref leads what is drawn. */
    ids: Record<string, string[]>;
    /** The same, as the drag found it: for Escape, and for "nothing moved". */
    before: Record<string, string[]>;
    /** Where the pointer is, and how far down the row it took hold. */
    pointerY: number;
    grab: number;
  }
  const lineDrag = useRef<LineDrag | null>(null);
  const [draggingLineId, setDraggingLineId] = useState<string | null>(null);
  // The placement to draw: the drag's while it is in the air, and then until
  // the saved sheet comes back holding it. Rows are the server's, so without
  // that second half the sheet would spring back to the old order for as long
  // as the save took, and land on the new one after.
  const [placement, setPlacement] = useState<Record<string, string[]> | null>(null);
  // The lifted row itself, and the sheet it is being carried around.
  const liftRef = useRef<HTMLTableRowElement | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  // Every row of the sheet by id, because a placement can hold a row that has
  // been carried out of the account the server still has it under.
  const lineById = new Map(cc.accounts.flatMap((a) => a.lineItems.map((l) => [l.id, l] as const)));

  /** This account's rows in the order to draw them. */
  function linesOf(account: Account): LineItem[] {
    const ids = placement?.[account.id];
    if (!ids) return account.lineItems;
    return ids.map((id) => lineById.get(id)).filter((l): l is LineItem => Boolean(l));
  }

  /**
   * Keep the lifted row under the pointer, wherever the rows have got to.
   *
   * Written straight to the node: this runs on every pointer move, and a state
   * update per pixel would re-render the whole sheet to move one row. The
   * measurement is of the row without its lift, which is the thing that changes
   * as the rows around it snap into place.
   */
  const lift = useCallback(() => {
    const el = liftRef.current;
    const d = lineDrag.current;
    if (!el || !d) return;
    el.style.transform = "";
    const box = el.getBoundingClientRect();
    let y = d.pointerY - d.grab - box.top;
    // Held inside the sheet's rows: past the first or the last there is nowhere
    // to put it, so it stops there and the pointer carries on without it.
    const rows = sheetRef.current?.querySelectorAll<HTMLElement>("tr[data-line]");
    if (rows && rows.length > 0) {
      const top = rows[0].getBoundingClientRect().top;
      const bottom = rows[rows.length - 1].getBoundingClientRect().bottom;
      y = Math.min(Math.max(y, top - box.top), bottom - box.height - box.top);
    }
    el.style.transform = `translateY(${y}px)`;
  }, []);

  /** Put the dragged row in `accountId`, beside `overId` — or at its end. */
  const place = useCallback((d: LineDrag, accountId: string, overId: string | null, after: boolean) => {
    const ids: Record<string, string[]> = {};
    for (const [key, list] of Object.entries(d.ids)) ids[key] = list.filter((x) => x !== d.id);
    const list = ids[accountId];
    if (!list) return;
    const at = overId ? list.indexOf(overId) : -1;
    list.splice(at === -1 ? list.length : at + (after ? 1 : 0), 0, d.id);
    // The pointer crosses a row many times over without changing anything.
    if (accountId === d.accountId && list.join() === d.ids[accountId].join()) return;
    d.ids = ids;
    d.accountId = accountId;
    setPlacement(ids);
  }, []);

  /**
   * Copying rows and accounts from one cost centre into another.
   *
   * What travels is what is ticked: a box on every row and every account, in
   * the sheet's left-hand margin beside the row numbers. Ticking says nothing
   * about what happens next — ⌘/Ctrl+C takes the ticked rows (or the row you are
   * standing in, if none are), ⌘/Ctrl+V puts them into whatever account you are
   * standing in, on any sheet in the budget.
   *
   * The clipboard itself belongs to the page (`clip`), because leaving this
   * sheet is the entire point and this component goes with it.
   *
   * The rows are named to the server by id, not by content — see the paste
   * route, which is also what re-points equations inside a copied block at the
   * copies. Nothing about a row is described twice.
   */
  const [ticked, setTicked] = useState<{ rows: Set<string>; accounts: Set<string> }>({
    rows: new Set(),
    accounts: new Set(),
  });

  const toggle = (kind: "rows" | "accounts", id: string) =>
    setTicked((was) => {
      const next = new Set(was[kind]);
      if (!next.delete(id)) next.add(id);
      return { ...was, [kind]: next };
    });
  const clearTicks = () => setTicked({ rows: new Set(), accounts: new Set() });

  /**
   * What is ticked *on this sheet*, in the order the sheet draws it.
   *
   * This sheet's, because the ticks outlive it: the component stays mounted as
   * the cost centre beside it changes, and a row ticked two sheets ago is not
   * something a copy here should quietly take. Drawing order, because that is
   * the order the rows will be pasted in.
   */
  function selection(): { accounts: string[]; rows: string[] } {
    const accounts: string[] = [];
    const rows: string[] = [];
    for (const account of cc.accounts) {
      if (ticked.accounts.has(account.id)) accounts.push(account.id);
      for (const li of linesOf(account)) if (ticked.rows.has(li.id)) rows.push(li.id);
    }
    return { accounts, rows };
  }
  const marked = selection();

  /** Which row and account the focus is in, read off the row's own markers. */
  function focusedRow(): { accountId: string; lineId?: string } | null {
    const el = document.activeElement as HTMLElement | null;
    const line = el?.closest<HTMLElement>("tr[data-line]");
    if (line?.dataset.account) return { accountId: line.dataset.account, lineId: line.dataset.line };
    const account = el?.closest<HTMLElement>("tr[data-account-row]");
    if (account?.dataset.accountRow) return { accountId: account.dataset.accountRow };
    return null;
  }

  /**
   * Put the ticked things on the clipboard. Accounts win where both are ticked:
   * an account brings its rows with it, so the rows inside one are already in
   * the copy and taking them twice would paste them twice.
   */
  function copySelection(): boolean {
    if (marked.accounts.length > 0) {
      const label = cc.accounts.find((a) => a.id === marked.accounts[0])?.accountCode ?? "";
      onCopy({ kind: "accounts", ids: marked.accounts, label });
      notify.success(t("copiedAccounts", { count: marked.accounts.length }));
      return true;
    }
    if (marked.rows.length > 0) {
      onCopy({ kind: "rows", ids: marked.rows, label: String(marked.rows.length) });
      notify.success(t("copiedRows", { count: marked.rows.length }));
      return true;
    }
    return false;
  }

  /** ⌘C with nothing ticked: the one row being stood in, which is what it looks
   *  like it should do. An account's own line takes the account, rows and all. */
  function copyHere(): boolean {
    if (copySelection()) return true;
    const at = focusedRow();
    if (!at) return false;
    if (!at.lineId) {
      const account = cc.accounts.find((a) => a.id === at.accountId);
      if (!account) return false;
      onCopy({ kind: "accounts", ids: [account.id], label: account.accountCode });
      notify.success(t("copiedAccounts", { count: 1 }));
      return true;
    }
    onCopy({ kind: "rows", ids: [at.lineId], label: "1" });
    notify.success(t("copiedRows", { count: 1 }));
    return true;
  }

  function pasteHere(): boolean {
    if (!clip || !isAdmin) return false;
    const at = focusedRow();
    const body =
      clip.kind === "accounts"
        ? { accountIds: clip.ids }
        : at
          ? { accountId: at.accountId, lineItemIds: clip.ids }
          : null;
    // Rows have to land in an account, and which one is not for this to guess.
    if (!body) {
      notify.info(t("pasteNeedsAccount"));
      return true;
    }
    // Only this sheet's accounts change, so only those are taken from the
    // answer: the cost centre it is linked to is the page's own, and the
    // response has no opinion about the result unit derived from it.
    api(`/api/budgets/${budgetId}/cost-centers/${cc.id}/paste`, "POST", body, (b, data) =>
      withSheet(b, cc.id, (sheet) => ({ ...sheet, accounts: (data as BudgetCC).accounts })),
    );
    return true;
  }

  /**
   * The sheet's own keys, taken before the cell layer sees them — that one
   * swallows anything it doesn't recognise while a cell is merely selected.
   *
   * Nothing is taken while a cell is being edited: ⌘C there is copying text out
   * of a formula, and it has nothing to do with the rows.
   */
  function sheetKeys(e: React.KeyboardEvent): boolean {
    if (cellEdit.className.includes("is-editing")) return false;
    if (!e.metaKey && !e.ctrlKey) return false;
    if (e.key === "c" || e.key === "C") {
      // Nothing copied means nothing taken: the browser's own copy still works
      // anywhere in the sheet that isn't a row.
      if (!copyHere()) return false;
      e.preventDefault();
      return true;
    }
    if (e.key === "v" || e.key === "V") {
      if (!pasteHere()) return false;
      e.preventDefault();
      return true;
    }
    return false;
  }

  const sheetProps = {
    ...cellEdit,
    onKeyDownCapture: (e: React.KeyboardEvent) => {
      if (sheetKeys(e)) return;
      cellEdit.onKeyDownCapture(e);
    },
  };

  /** The tick box in the margin, on every row that can be copied. The app's own
   *  square — the one the multi-select picker marks its options with. */
  function tickBox(kind: "rows" | "accounts", id: string, label: string) {
    return (
      <Checkbox checked={ticked[kind].has(id)} onChange={() => toggle(kind, id)} label={label} />
    );
  }

  function startLineDrag(e: React.PointerEvent, account: Account, li: LineItem) {
    if (!isAdmin || e.button !== 0) return;
    const tr = (e.target as HTMLElement).closest("tr");
    if (!tr) return;
    // Or the pointer selects its way down the sheet as the row follows it.
    e.preventDefault();
    const ids: Record<string, string[]> = {};
    for (const a of cc.accounts) ids[a.id] = linesOf(a).map((l) => l.id);
    lineDrag.current = {
      id: li.id,
      fromAccountId: account.id,
      accountId: account.id,
      ids,
      before: ids,
      pointerY: e.clientY,
      grab: e.clientY - tr.getBoundingClientRect().top,
    };
    setPlacement(ids);
    setDraggingLineId(li.id);
  }

  // Put the row back under the pointer once the rows have been redrawn around
  // it — before the frame is painted, so the two never disagree on screen.
  useLayoutEffect(() => {
    if (draggingLineId) lift();
  }, [placement, draggingLineId, lift]);

  // Followed on the window: the pointer leaves the grip within a few pixels,
  // the row it belongs to being on its way out from under it.
  useEffect(() => {
    if (!draggingLineId) return;
    const clear = () => {
      // The lift is this row's own inline style, and the row outlives the drag.
      if (liftRef.current) liftRef.current.style.transform = "";
      liftRef.current = null;
      lineDrag.current = null;
      setDraggingLineId(null);
    };
    const move = (e: PointerEvent) => {
      const d = lineDrag.current;
      if (!d) return;
      d.pointerY = e.clientY;
      // What is under the pointer, asked of the page rather than worked out:
      // the lifted row is `pointer-events-none`, so this sees the sheet it is
      // being carried over. A heading or a Summa is nothing to land on, and the
      // placement simply stands until the pointer is over a row again.
      const under = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
      const over = under?.closest<HTMLElement>("tr[data-line]");
      const end = under?.closest<HTMLElement>("tr[data-line-end]");
      if (over?.dataset.line && over.dataset.account && over.dataset.line !== d.id) {
        const box = over.getBoundingClientRect();
        place(d, over.dataset.account, over.dataset.line, e.clientY > box.top + box.height / 2);
      } else if (end?.dataset.lineEnd) {
        // The new-row line, under the last of an account's rows — and the only
        // thing to aim at in an account that has none.
        place(d, end.dataset.lineEnd, null, false);
      }
      lift();
    };
    // Saved once, when it is let go — not on every row it crossed on the way.
    // One request even when the row changed account: the rows it left keep the
    // order they had, and the route moves it over (see the reorder endpoint).
    //
    // The arrangement was this screen's to begin with, so it is also what the
    // budget is patched with — `withLineOrder` is the same rule the route
    // applies, over the same list. The placement stands until that lands, and
    // is then let go onto a budget that already says the same thing.
    const stop = () => {
      const d = lineDrag.current;
      const to = d?.accountId;
      const moved =
        d && to && (to !== d.fromAccountId || d.ids[to].join() !== d.before[to].join());
      if (d && to && moved) {
        const ids = d.ids[to];
        api(`/api/budget-accounts/${to}/line-items/reorder`, "POST", { orderedIds: ids }, (b) =>
          withLineOrder(b, to, ids),
        ).then(() => setPlacement(null));
      } else {
        setPlacement(null);
      }
      clear();
    };
    const cancel = () => {
      setPlacement(null);
      clear();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancel();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", key);
    };
  }, [draggingLineId, api, lift, place]);

  function accountBlock(account: Account) {
    const accountKey = `${ccCode}:${account.accountCode}`;
    const total = ev.accounts[accountKey];
    const totalIncomplete = badAccount.has(accountKey);
    const open = openComments.has(account.id);
    const d = draft(account.id);
    const incomeLike = effectiveKind(account.accountCode, account.kindOverride) === "INCOME";

    // The same account on the other side. Rows are matched on their description
    // (lineKeys), so `keys[i]` is what this sheet's i-th row is known as over
    // there, and anything left over is a row only they have.
    const cmp = compareAccounts.get(account.accountCode);
    // Off the rows as drawn, not as they arrived: a row being dragged is in a
    // different place, and its comparison has to travel with it.
    const lines = linesOf(account);
    const keys = lineKeys(lines);
    const cmpLines = new Map((cmp?.lines ?? []).map((l) => [l.key, l]));
    const ghostLines = (cmp?.lines ?? []).filter((l) => !keys.includes(l.key));

    // Editorial changes in force on this account. They are already inside
    // `total` — the evaluator adds them (lib/budget/eval.ts) — so the rows below
    // are what makes the figure explicable rather than merely different from
    // what was adopted.
    const adjRows = adjustments.get(account.id) ?? [];
    const adjTotal = adjRows.reduce((sum, r) => sum + r.amount, 0);
    return (
      <tbody key={account.id} className="border-b border-border">
        {/* Marked like the rows below it: standing in this line and copying
            takes the account and everything under it. */}
        <tr data-account-row={account.id} className="group bg-background">
          {gut(
            grid.accountRow.get(`${ccCode}|${account.id}`),
            isAdmin && tickBox("accounts", account.id, t("selectAccount", { code: account.accountCode })),
          )}
          <td className="group relative border-r border-border/60 bg-brand p-0 align-middle">
            {isAdmin && (
              <DragHandle
                onDragStart={(e) => { e.dataTransfer.setData("accountId", account.id); e.dataTransfer.effectAllowed = "move"; }}
                className="pointer-events-none absolute inset-y-0 left-0 z-10 flex items-center px-1.5 text-on-brand/60 hover:text-on-brand group-hover:pointer-events-auto"
                title={t("dragToSection")}
              />
            )}
            {isAdmin ? (
              <Combobox
                options={accountOptionsFor(account.accountCode)}
                value={account.accountCode}
                onChange={(v) => {
                  if (v === account.accountCode) return;
                  // The code pulls the name with it, resolved from the chart, so
                  // both are taken off the answer — and only those two, since
                  // the account's rows are not in it.
                  api(`/api/budget-accounts/${account.id}`, "PATCH", { accountCode: v }, (b, data) =>
                    withAccount(b, account.id, (a) => ({
                      ...a,
                      accountCode: (data as Account).accountCode,
                      accountName: (data as Account).accountName,
                    })),
                  );
                }}
                placeholder={tBook("accountPlaceholder")}
                searchPlaceholder={tBook("accountSearch")}
                emptyText={accounts.length ? t("noMoreAccounts") : t("emptyChart")}
                align="center"
                buttonClassName="px-2 py-1.5 font-mono text-sm font-semibold text-on-brand"
                chevronClassName="text-on-brand/60"
                aria-label={t("accountNumber")}
              />
            ) : (
              <div className="px-2 py-1.5 text-center font-mono text-sm font-semibold text-on-brand">
                {account.accountCode}
              </div>
            )}
          </td>
          {/* Read-only: the name follows the account code from the chart. */}
          <td className="border-r border-border/60 px-3 py-1.5 text-sm font-semibold" colSpan={columns.length - 1}>
            {account.accountName}
          </td>
          {actualPad}
          <td className="whitespace-nowrap px-1 text-left text-xs text-muted">
            <span className="flex items-center">
              {isAdmin && del(
                () => api(`/api/budget-accounts/${account.id}`, "DELETE", undefined, (b) =>
                  withoutAccount(b, account.id),
                ),
                t("removeAccount"),
              )}
            </span>
          </td>
        </tr>

        {lines.map((li, i) => (
          <tr
            key={li.id}
            // What a drag reads the sheet by: every row it may land among says
            // which row it is and whose account it belongs to.
            data-line={li.id}
            data-account={account.id}
            // Only ever set, never cleared: a row carried into another account
            // is a different <tr> under a different <tbody>, and React mounts
            // the new one around the same time it drops the old.
            ref={(el) => {
              if (el && draggingLineId === li.id) liftRef.current = el;
            }}
            className={cn(
              "group border-t border-border/40 transition-colors hover:bg-surface/40",
              // Lifted: over the rows it passes, on the sheet's own background
              // so they don't read through it, and outlined so it is a row in
              // hand rather than one that happens to overlap. Outline and not a
              // shadow: box-shadow is not painted on the rows of a
              // border-collapse table, which this is.
              //
              // `pointer-events-none` is what lets the drag see the sheet
              // underneath it — the row is directly under the pointer the whole
              // way, and it cannot be the answer to what it is over.
              draggingLineId === li.id &&
                "pointer-events-none relative z-10 bg-background outline outline-1 outline-border",
              // Ticked, and so part of what a copy would take.
              ticked.rows.has(li.id) && "bg-accent-soft/40",
            )}
          >
            {gut(
              grid.lineRow.get(`${ccCode}|${li.id}`),
              isAdmin && tickBox("rows", li.id, t("selectRow")),
            )}
            {columns.map((col) => lineCell(col, li, account))}
            {showCompare && (
              <CompareCells other={cmpLines.get(keys[i])?.values[1]} own={ev.lineItems[li.id]} incomeLike={incomeLike} />
            )}
            <td className="px-1 text-left text-muted">
              {isAdmin && del(
                () => api(liUrl(li.id), "DELETE", undefined, (b) => withoutLine(b, li.id)),
                tAlloc("removeRow"),
              )}
            </td>
          </tr>
        ))}

        {/* Editorial changes, one row each, under the adopted rows they change.
            Never editable — a change is amended by recording another one, not
            by rewriting it (see the changes view). */}
        {adjRows.map((row) => (
          <tr key={row.change.id} className="border-t border-border/40 bg-warning-soft/40">
            {gut(undefined)}
            {columns.map((col) => {
              if (col.key === "beskrivning") return (
                <td key={col.key} className="border-r border-border/60 px-2 py-1.5 text-sm">
                  <span className="flex items-center gap-1.5 pl-3">
                    <span className="shrink-0 font-medium text-warning">
                      {tChanges("label", { kind: row.change.kind, seq: row.change.seq })}
                    </span>
                    <span className="min-w-0 truncate text-muted" title={row.change.reason}>
                      {row.change.reason}
                    </span>
                    <span className="shrink-0 text-xs text-muted/70">
                      {date(row.change.createdAt)}
                    </span>
                  </span>
                </td>
              );
              if (col.key === "expression") return (
                <td key={col.key} className="border-r border-border/60 px-2 py-1.5 text-right font-medium tabular-nums">
                  {fmtSigned(row.amount)}
                </td>
              );
              return <td key={col.key} className="border-r border-border/60" />;
            })}
            {actualPad}
            <td />
          </tr>
        ))}

        {/* Rows only the other side has. Nothing here is editable: they are not
            this budget's rows, and adding them is a decision, not a formality. */}
        {ghostLines.map((l) => (
          <tr key={`ghost-${l.key}`} className="border-t border-border/40 text-muted">
            {gut(undefined)}
            {columns.map((col) => (
              <td key={col.key} className="border-r border-border/60 px-2 py-1.5 text-sm">
                {col.key === "beskrivning" && <span className="pl-3">{l.description || "—"}</span>}
              </td>
            ))}
            <CompareCells other={l.values[1]} own={undefined} incomeLike={incomeLike} />
            <td />
          </tr>
        ))}

        {isAdmin && (
          // Also where a dragged row lands when it is carried this far down an
          // account — including an account with no rows of its own, which has
          // nothing else to aim at.
          <tr data-line-end={account.id} className="border-t border-border/40 bg-background">
          <td className={narrow ? "p-0" : "w-9 border-r border-border/60"} />
            {columns.map((col) => {
              const base = "w-full bg-transparent px-2 py-1.5 outline-none placeholder:text-muted/40 focus:bg-accent-soft/40";
              const onEnter = (e: React.KeyboardEvent) => { if (e.key === "Enter") createLine(account.id); };
              if (col.key === "beskrivning") return <td key={col.key} className="border-r border-border/60 p-0"><input aria-label={t("newLine")} value={d.description} onChange={(e) => setDraft(account.id, { description: e.target.value })} onKeyDown={onEnter} placeholder={t("newLine")} className={cn(base, "pl-5 text-sm text-muted")} /></td>;
              if (col.key === "expression") return <td key={col.key} className="border-r border-border/60 p-0"><input aria-label={tCol("expression")} value={d.expression} onChange={(e) => setDraft(account.id, { expression: e.target.value })} onKeyDown={onEnter} onBlur={() => createLine(account.id)} placeholder={tCol("expression").toLowerCase()} className={cn(base, "text-right font-mono text-xs")} /></td>;
              return <td key={col.key} className="border-r border-border/60" />;
            })}
            {actualPad}
            <td />
          </tr>
        )}

        {/* Account total, summed below the individual lines (under Belopp). The
            two trailing cells carry the compared figure and its diff vs budget. */}
        <tr className="border-t border-border/60 bg-surface/40">
          {gut(undefined)}
          <td colSpan={columns.length - 1} className="px-2 py-1.5 text-right text-[11px] font-semibold uppercase tracking-wide text-muted">
            {t("sum")}
            {/* What the account said before the changes — the number that was
                voted through, kept beside the one in force so neither has to be
                worked out from the other. */}
            {adjTotal !== 0 && total !== undefined && (
              <span className="ml-2 font-normal normal-case tracking-normal text-muted/70">
                {t("originally", { amount: fmt(total - adjTotal) })}
              </span>
            )}
            {/* Says the sum is short a row rather than letting a partial total
                pass for the budgeted amount. The rows themselves are already
                marked; this is the figure they add up to admitting it. */}
            {totalIncomplete && (
              <span className="ml-2 font-normal normal-case tracking-normal text-warning">
                {t("incompleteSum")}
              </span>
            )}
          </td>
          <td className={cn("px-2 py-1.5 text-right font-semibold tabular-nums", totalIncomplete && "text-warning", total !== undefined && total < 0 && !totalIncomplete && "text-danger")}>{fmt(total)}</td>
          {showCompare && <CompareCells other={cmp?.totals[1]} own={total} incomeLike={incomeLike} strong />}
          <td className="whitespace-nowrap px-1 text-left text-xs text-muted">
            {canComment && (
              <button
                onClick={() => setOpenComments((s) => { const n = new Set(s); if (n.has(account.id)) n.delete(account.id); else n.add(account.id); return n; })}
                title={t("comments")}
                aria-label={t("commentsCount", { count: account.comments.length })}
                aria-expanded={open}
                className={cn(
                  "flex items-center gap-1 rounded-lg px-1.5 py-1 tabular-nums transition hover:bg-surface hover:text-foreground",
                  // Accent while the thread is open; a plain (unmuted) icon means
                  // "there is something to read here" without opening it.
                  open ? "text-accent" : account.comments.length > 0 && "text-foreground",
                )}
              >
                <IconComment className="size-4" />
                {account.comments.length > 0 && account.comments.length}
              </button>
            )}
          </td>
        </tr>

        {open && (
          <tr className="bg-surface/20">
            {/* sheet-field: what's in here is a form field, not a sheet cell —
                it keeps the app's focus ring and this row draws no cell box. */}
            <td colSpan={totalCols} className="sheet-field px-4 py-3">
              <div className="space-y-2">
                {account.comments.length === 0 && <p className="text-xs text-muted">{t("noComments")}</p>}
                {account.comments.map((cm) => (
                  <div key={cm.id} className="group flex items-start gap-2 text-sm">
                    <span className="shrink-0 font-medium">{cm.author.name}</span>
                    <span className="flex-1 text-muted">{cm.body}</span>
                    {(cm.author.id === userId || isAdmin) && (
                      <span className="shrink-0">{del(
                        () => api(`/api/budget-comments/${cm.id}`, "DELETE", undefined, (b) =>
                          withoutComment(b, cm.id),
                        ),
                        t("removeComment"),
                      )}</span>
                    )}
                  </div>
                ))}
                {canComment && (
                  <input
                    value={commentDraft[account.id] ?? ""}
                    onChange={(e) => setCommentDraft((m) => ({ ...m, [account.id]: e.target.value }))}
                    onKeyDown={async (e) => {
                      if (e.key !== "Enter") return;
                      const body = (commentDraft[account.id] ?? "").trim();
                      if (!body) return;
                      const ok = await api(
                        `/api/budget-accounts/${account.id}/comments`,
                        "POST",
                        { body },
                        (b, data) => withComment(b, account.id, data as Comment),
                      );
                      if (ok) setCommentDraft((m) => ({ ...m, [account.id]: "" }));
                    }}
                    placeholder={t("commentPlaceholder")}
                    className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm"
                  />
                )}
              </div>
            </td>
          </tr>
        )}
      </tbody>
    );
  }

  // A whole account only the other side has: it is budgeted for (or was spent
  // on) over there and not at all here. Shown in full, read-only, so the gap is
  // legible down to the row — this is the case a left join would have hidden.
  function ghostAccountBlock(account: JoinedAccount) {
    const incomeLike = account.kind === "INCOME";
    return (
      <tbody key={`ghost-${account.code}`} className="border-b border-border">
        <tr className="bg-background text-muted">
          {gut(undefined)}
          {/* A ghost row's account cell is the real cell held back, so it keeps
              the pink but at a fraction. The label follows the ground rather
              than the fill: at this alpha the fill lands pale over white and
              dark over the dark canvas, and a fixed near-black label was 2.3:1
              in the dark theme. */}
          <td className="border-r border-border/60 bg-brand/25 px-2 py-1.5 text-center font-mono text-sm font-semibold text-foreground">
            {account.code}
          </td>
          <td className="border-r border-border/60 px-3 py-1.5 text-sm font-semibold" colSpan={columns.length - 1}>
            {account.name}
            <span className="ml-2 text-xs font-normal">· {tRam("notInThisBudget")}</span>
          </td>
          <CompareCells other={account.totals[1]} own={undefined} incomeLike={incomeLike} strong />
          <td />
        </tr>
        {account.lines.map((l) => (
          <tr key={l.key} className="border-t border-border/40 text-muted">
            {gut(undefined)}
            {columns.map((col) => (
              <td key={col.key} className="border-r border-border/60 px-2 py-1.5 text-sm">
                {col.key === "beskrivning" && <span className="pl-3">{l.description || "—"}</span>}
              </td>
            ))}
            <CompareCells other={l.values[1]} own={undefined} incomeLike={incomeLike} />
            <td />
          </tr>
        ))}
      </tbody>
    );
  }

  // The "+ new account" row at the foot of a section. One picker over the chart —
  // the name follows from the account, so there is nothing else to type.
  function addAccountRow(kind: AccountKind) {
    if (!isAdmin) return null;
    return (
      <tbody>
        <tr className="bg-background">
          <td className="w-9 border-r border-border/60" />
          <td className="p-0" colSpan={columns.length + 1}>
            <Combobox
              options={accountOptions}
              value=""
              onChange={(v) => createAccount(kind, v)}
              placeholder={t(kind === "INCOME" ? "newIncomeAccount" : "newCostAccount")}
              searchPlaceholder={tBook("accountSearch")}
              emptyText={accounts.length ? t("noMoreAccounts") : t("emptyChart")}
              buttonClassName="w-full bg-transparent px-2 py-1.5 text-sm text-muted/60 hover:bg-accent-soft/40"
              aria-label={t("addAccount")}
            />
          </td>
          {actualPad}
        </tr>
      </tbody>
    );
  }

  // One section (income / costs) as its own rounded card. The whole card
  // is a drop zone — dropping an account row here flips it to this kind.
  function sectionCard(kind: AccountKind, label: string, accts: Account[], ghosts: JoinedAccount[], total: number) {
    const active = dropKind === kind;
    return (
      <div
        {...dropProps(kind)}
        className={cn(
          "budget-grid overflow-x-auto rounded-2xl border bg-background transition-colors",
          active ? "border-accent ring-1 ring-accent" : "border-border",
        )}
      >
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <h3 className="text-sm font-semibold">
            {label}
            {active && <span className="ml-2 text-xs font-normal text-muted">— {t("dropHere")}</span>}
          </h3>
          <span className="text-sm tabular-nums text-muted">{fmt(total)}</span>
        </div>
        <table className="w-full border-collapse text-sm table-fixed">
          <colgroup>
            <col style={{ width: GUT_W }} />
            {columns.map((col) => { const w = staticWidth(col); return <col key={col.key} style={w ? { width: w } : undefined} />; })}
            {showCompare && <col style={{ width: 104 }} />}
            {showCompare && <col style={{ width: 96 }} />}
            <col style={{ width: ACT_W }} />
          </colgroup>
          <thead>
            <tr className="border-b border-border text-left text-xs font-medium text-muted">
              {narrow ? (
                <th className="p-0" />
              ) : (
                <th className="select-none border-r border-border/60 px-1 py-2 text-center font-mono text-[10px] text-muted/50">#</th>
              )}
              {columns.map((col) => (
                <Hc key={col.key} letter={col.letter} align={col.kind === "number" ? "right" : undefined}>{col.custom ? col.name : tCol(col.name)}</Hc>
              ))}
              {showCompare && compare && <th className="border-l border-border/60 px-2 py-2 text-right font-medium">{compare.label}</th>}
              {showCompare && <th className="border-r border-border/60 px-2 py-2 text-right font-medium">{tLedger("col.diff")}</th>}
              <th className="border-l border-border/60" />
            </tr>
          </thead>
          {accts.map(accountBlock)}
          {ghosts.map(ghostAccountBlock)}
          {addAccountRow(kind)}
        </table>
      </div>
    );
  }

  // Written once and drawn twice — the strip on a phone and the tiles above md
  // must never be able to disagree about what the sheet comes to.
  const summary = [
    { label: t("totalIncome"), v: totals.income, a: compareTotals.income, incomeLike: true, signed: false, impact: undefined as number | undefined },
    { label: t("totalCosts"), v: totals.cost, a: compareTotals.cost, incomeLike: false, signed: false, impact: undefined as number | undefined },
    { label: tRam("result"), v: totals.result, a: compareTotals.result, signed: true, incomeLike: true, impact: changeImpact },
  ];

  return (
    <div ref={sheetRef} {...sheetProps}>
      {/* summary — the same three figures in two shapes.
          Not a <Card>, on purpose and for the same reason the sheets below
          don't look like the rest of the app: no shadow, and the figures in the
          sheet's own flat notation rather than the app's Amount (see DESIGN.md
          → Money). A tile carries three things a stat card doesn't — the
          compared side, the difference from it, and how far the editorial
          changes have moved the result. */}

      {/* On a phone: one strip, pinned under the app bar.
          StatRow auto-fits at `minmax(200px, 1fr)`, which on 361px of screen is
          one column — so the three tiles stacked to 266–362px, and most of the
          first screenful of a budget was three numbers. Here they are 56px, and
          they stay on screen while you scroll the rows that decide them, which
          is when the result is actually worth looking at. What the tiles said
          underneath — the compared side and what the changes have done — is one
          tap down rather than always printed. */}
      <div className="sticky top-14 z-10 rounded-2xl border border-border bg-background shadow-[var(--shadow-card)] md:hidden">
        <button
          type="button"
          onClick={() => setSummaryOpen((o) => !o)}
          aria-expanded={summaryOpen}
          className="grid w-full grid-cols-3 gap-2 px-3 py-2 text-left"
        >
          {summary.map((s) => (
            <span key={s.label} className="min-w-0">
              <span className="block truncate text-[11px] text-muted">{s.label}</span>
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
                <p key={s.label} className="flex items-baseline justify-between gap-2 text-muted">
                  <span className="truncate">
                    {s.label} · {compare.label}
                  </span>
                  <span className="shrink-0 tabular-nums text-foreground">
                    {fmt(s.a)}
                    <span className={cn("ml-2", diffClass(s.a - s.v, s.incomeLike))}>
                      {fmtSigned(s.a - s.v)}
                    </span>
                  </span>
                </p>
              ))}
            {changeImpact !== 0 && (
              <p className="flex items-baseline justify-between gap-2 text-muted">
                <span className="truncate">{tRam("changes")}</span>
                <span className="shrink-0 tabular-nums">
                  <span className={diffClass(changeImpact, true)}>{fmtSigned(changeImpact)}</span>
                  <span className="ml-2 text-muted">
                    {t("originallyLabel")}{" "}
                    <span className="tabular-nums text-foreground">
                      {fmtSigned(totals.result - changeImpact)}
                    </span>
                  </span>
                </span>
              </p>
            )}
            {/* The comparison's own columns add ~200px to a sheet that has
                361px to spend, so on a phone they are asked for rather than
                assumed. Off, the sheet fits; on, it scrolls sideways — which is
                a fair price for a thing you turned on. */}
            {compare && (
              <button
                type="button"
                onClick={() => setCompareOnPhone((v) => !v)}
                className="text-xs font-medium text-accent"
              >
                {compareOnPhone ? t("hideCompareColumns") : t("showCompareColumns")}
              </button>
            )}
          </div>
        )}
      </div>

      {/* From md: the three tiles, exactly as they were. */}
      <div className="hidden md:block">
        <StatRow>
          {summary.map((s) => (
            <div key={s.label} className="rounded-2xl border border-border bg-background px-4 py-3">
              <p className="text-xs text-muted">{s.label}</p>
              <p className={cn("mt-0.5 text-xl font-semibold tabular-nums", s.signed && (s.v < 0 ? "text-danger" : s.v > 0 ? "text-success" : ""))}>
                {s.signed ? fmtSigned(s.v) : fmt(s.v)}
              </p>
              {compare && (
                <p className="mt-1 text-xs text-muted">
                  {compare.label} <span className="tabular-nums text-foreground">{fmt(s.a)}</span>
                  <span className={cn("ml-2 tabular-nums", diffClass(s.a - s.v, s.incomeLike))}>{fmtSigned(s.a - s.v)}</span>
                </p>
              )}
              {/* The result is the one in force; this is how far it has moved from
                  the adopted one, and in which direction. */}
              {s.impact !== undefined && s.impact !== 0 && (
                <p className="mt-1 text-xs text-muted">
                  {tRam("changes")}{" "}
                  <span className={cn("tabular-nums", diffClass(s.impact, true))}>{fmtSigned(s.impact)}</span>
                  <span className="ml-2">
                    {t("originallyLabel")}{" "}
                    <span className="tabular-nums text-foreground">{fmtSigned(s.v - s.impact)}</span>
                  </span>
                </p>
              )}
            </div>
          ))}
        </StatRow>
      </div>

      {/* What is ticked, and what it can be made into. It appears only once
          something is, so the sheet is as quiet as it was until you start. */}
      {isAdmin && (marked.rows.length > 0 || marked.accounts.length > 0) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-border bg-surface/60 px-4 py-2 text-sm">
          <span className="font-medium">
            {marked.accounts.length > 0
              ? t("markedAccounts", { count: marked.accounts.length })
              : t("markedRows", { count: marked.rows.length })}
          </span>
          <button
            type="button"
            onClick={copySelection}
            className="text-sm font-medium text-accent hover:underline"
          >
            {t("copyMarked")}
          </button>
          <span className="text-xs text-muted">⌘/Ctrl+C</span>
          <button
            type="button"
            onClick={clearTicks}
            className="ml-auto text-xs font-medium text-accent hover:underline"
          >
            {t("clearMarked")}
          </button>
        </div>
      )}

      {/* What is on the clipboard, and what to do with it. Here rather than
          against every account: a copy is one thing at a time, and it is the
          same one wherever in the budget you have gone to put it. It is also
          the only place the shortcut is written down, which is what stops the
          whole feature from being a secret. */}
      {isAdmin && clip && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-accent/40 bg-accent-soft/40 px-4 py-2 text-sm">
          <span className="font-medium">
            {clip.kind === "rows"
              ? t("copiedRows", { count: clip.ids.length })
              : t("copiedAccountCode", { code: clip.label })}
          </span>
          <span className="text-xs text-muted">
            {clip.kind === "rows" ? t("pasteRowsHint") : t("pasteAccountsHint")}
          </span>
          <button
            type="button"
            onClick={() => onCopy(null)}
            className="ml-auto text-xs font-medium text-accent hover:underline"
          >
            {t("clearClipboard")}
          </button>
        </div>
      )}

      {sectionCard("INCOME", tRam("income"), income, ghostAccounts.filter((a) => a.kind === "INCOME"), totals.income)}
      {sectionCard("COST", tRam("costs"), cost, ghostAccounts.filter((a) => a.kind === "COST"), totals.cost)}
    </div>
  );
}

// The compared figure and its difference from the budgeted one — the two cells
// that follow Belopp whenever a comparison is on. An absent figure on the other
// side leaves the difference blank rather than reading it as a fall to zero;
// an absent figure on this side is a real zero, since not budgeting for
// something is budgeting nothing for it.
function CompareCells({ other, own, incomeLike, strong }: {
  other: number | undefined; own: number | undefined; incomeLike: boolean; strong?: boolean;
}) {
  const diff = other === undefined ? undefined : other - (own ?? 0);
  return (
    <>
      <td className={cn("border-l border-border/40 px-2 py-1.5 text-right tabular-nums text-muted", strong && "font-semibold")}>
        {fmt(other)}
      </td>
      <td className={cn("px-2 py-1.5 text-right tabular-nums", strong && "font-semibold", diff !== undefined && diffClass(diff, incomeLike))}>
        {fmtSigned(diff)}
      </td>
    </>
  );
}

// Column header with its A1 letter shown before the name (the six general
// columns are unnamed, so they show just their letter).
function Hc({ letter, align, title, children }: {
  letter: string; align?: "right"; title?: string; children: React.ReactNode;
}) {
  return (
    <th title={title} className={cn("border-r border-border/60 px-2 py-2", align === "right" ? "text-right" : "text-left")}>
      <span className="mr-1 font-mono text-[10px] font-normal text-muted/40">{letter}</span>{children}
    </th>
  );
}
