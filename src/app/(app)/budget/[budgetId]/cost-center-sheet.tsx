// The per-cost-centre sheet: income / costs as two rounded cards, each an
// account → line-items → Summa table. Owns the drag-reclassify + row-reorder
// drag handlers and the per-sheet drafts; the select/edit behaviour comes from
// useCellEdit, and the cell renderers and `api` from the budget client.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { effectiveKind, isResultAccount, type AccountKind } from "@/lib/budget";
import { sheetTotals, ZERO_TOTALS, type JoinedSheet } from "@/lib/budget/compare";
import { type BudgetGrid, type ColumnDef } from "@/lib/budget/grid";
import { autoScrollStep, verticalScroller } from "@/lib/ui/auto-scroll";
import { useFormat } from "@/lib/ui/use-format";
import { usePhone } from "@/lib/ui/media";
import { cn } from "@/lib/ui/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { IconButton } from "@/components/ui/icon-button";
import { IconTrash } from "@/components/ui/icons";
import { resultImpact } from "@/lib/budget/changes";

import { ccTotals, diffClass, fmt, fmtSigned, type AdjustmentRow } from "./budget-helpers";
import {
  withLine, withLineOrder, withNewAccount, withSheet
} from "./patch-budget";
import { useCellEdit } from "./use-cell-edit";
import { useSheetClipboard } from "./use-sheet-clipboard";
import { SheetProvider, type SheetValue } from "./sheet-context";
import { SectionCard } from "./sheet-section";
import { useNotify } from "@/components/shell/notifications";
import type { AccountRecord } from "@/lib/domain/types";
import type { Account, BudgetCC, BudgetClip, Evaluated, LineItem, Draft, CellFn, FormulaFn, ApiFn } from "./budget-types";

/** This sheet, joined against the one side it is being compared with. */
export interface SheetCompare { label: string; sheet: JoinedSheet }

export function CostCenterSheet(props: {
  cc: BudgetCC; ccCode: string; ev: Evaluated; grid: BudgetGrid; columns: ColumnDef[];
  compare: SheetCompare | null;
  isAdmin: boolean; canComment: boolean; userId: string;
  renderCell: CellFn; renderFormula: FormulaFn; api: ApiFn; budgetId: string;
  accounts: AccountRecord[];
  /** Editorial adjustments in force, by account id. See budget-helpers. */
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
  const tGroup = useTranslations("budget.compareGroups");
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

  const badLine = new Set(ev.badLineItems);
  // Accounts whose total is short a row that didn't resolve. The figure below
  // is still the sum of the rows that did, because a sheet you can't read is no
  // help in finding the row to fix, so this is what says it is a partial one.
  const badAccount = new Set(ev.badAccounts);
  // The left margin: the row's A1 number and the box that picks the row out for
  // a copy, in one cell rather than a column each. A whole column of furniture
  // for a 16px square is a column the figures don't get.
  //
  // The box is centred in the cell and the number is laid over its left edge,
  // out of the flow, so that neither can push the other about: the boxes line
  // up straight down the sheet whatever the numbers beside them are doing, and
  // a row without a number keeps its box in the same place as the rest.
  // `table-fixed` sizes the column from the colgroup and never from what is in
  // it, so a 0px column whose cells still carry padding, a border and a tick box
  // does not collapse. It overflows into the column beside it. On a phone the
  // cell is emptied rather than squeezed.
  const gut = (n: number | undefined, box?: React.ReactNode) =>
    narrow ? (
      <td className="p-0" />
    ) : (
      <td className="relative select-none border-r border-border/60 px-1 align-middle">
        <span className="absolute inset-y-0 left-1 flex items-center font-mono text-[10px] leading-8 text-muted">
          {n ?? ""}
        </span>
        <span className="flex h-8 items-center justify-center">{box}</span>
      </td>
    );

  // Row delete. Revealed on row hover (like the drag grip) so a long sheet isn't
  // a column of bins. Keyboard focus reveals it too, so it stays reachable
  // without a mouse.
  const del = (onClick: () => void, label: string) => (
    <IconButton tone="danger" reveal onClick={onClick} label={label}>
      <IconTrash className="size-4" />
    </IconButton>
  );

  const income = cc.accounts.filter((a) => effectiveKind(a.accountCode) === "INCOME");
  const cost = cc.accounts.filter((a) => effectiveKind(a.accountCode) === "COST");
  const totals = ccTotals(cc, ev);

  // How much of this sheet's result is editorial changes rather than what
  // was adopted. The totals above already contain them; this is what says so.
  const changeImpact = cc.accounts.reduce((sum, a) => {
    const net = (adjustments.get(a.id) ?? []).reduce((s, r) => s + r.amount, 0);
    return sum + resultImpact(effectiveKind(a.accountCode), net);
  }, 0);

  // Whatever is being compared against, the year's utfall or another budget
  // (see use-comparison.tsx), shown as two extra, non-grid columns after
  // Belopp, on the account totals and on each row.
  //
  // The other side is looked up through the join, so what only it has is here
  // too: an account it budgets for that this sheet doesn't (`ghostAccounts`),
  // and rows inside a shared account that this one lacks. Those render read-only
  // and unbudgeted, because the point of showing them is that the blank is the finding.
  // Below md the sheet has 361px of screen and 506px of fixed columns, so
  // something has to give. What gives is the chrome (see the widths below)
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
    ? compare.sheet.accounts.filter((a) => !ownCodes.has(a.code))
    : [];
  // Two empty trailing cells to keep non-Summa rows aligned when they show.
  const actualPad = showCompare ? <><td className="border-l border-border/40" /><td /></> : null;

  // Column geometry. The table is: gutter + every column (+ compare + diff) + action.
  const totalCols = columns.length + 2 + (showCompare ? 2 : 0); // full-width spanners (comments)
  const liUrl = (id: string) => `/api/budget-line-items/${id}`;

  // Fixed widths; Beskrivning is left elastic so it fills the row. The table is
  // w-full, so it always fits its container with no horizontal scrollbar.
  // The action column holds a trash icon on every row, plus the comment toggle
  // (icon + count) on account rows, wide enough for both without wrapping.
  //
  // Two sets of them, because the desktop set came to 506px of fixed columns
  // and a phone has 361px of screen. Beskrivning, the column you actually read,
  // was collapsing to nothing and the sheet was something you dragged
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

  // Accounts come from the synced chart, so a budget can only refer to accounts
  // the ledger actually reports on. Ones already on this sheet are filtered out
  // and `keep` is the row's own account, which has to stay in its own picker for
  // the value to resolve to a label.
  //
  // Narrowed twice more. Balance accounts are never offered: 1xxx and 2xxx are
  // what the section owns and owes, not what a year earns or spends, and one
  // picked by mistake used to be filed silently as a cost. And a section only
  // offers its own side, so the picker under Intäkter lists 3xxx and the one
  // under Kostnader lists 4xxx-8xxx. The server refuses the rest either way
  // (lib/budget/account-validation.ts); this is so the wrong one is never
  // reachable in the first place.
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
    // The name is resolved server-side from the chart, which is the reason the
    // new account is taken from the response rather than assembled here: this
    // side knows the code that was asked for, and the server knows what it is
    // called. It comes back with its (empty) rows and comments on it.
    await api(
      `/api/budgets/${budgetId}/cost-centers/${cc.id}/accounts`,
      "POST",
      // The section, so the server can refuse a code that does not belong on
      // it. Not a classification: 3xxx is income whatever this said.
      { accountCode: code.trim(), kind },
      (b, data) => withNewAccount(b, cc.id, data as Account),
    );
  }

  /**
   * Reordering a line by hand, within its account or onto another one.
   *
   * The row is lifted out and follows the pointer; the rows it passes snap into
   * the gap it left, one at a time, as the pointer crosses each halfway mark.
   * The same drag as the voucher table's (components/voucher-editor.tsx). A
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
    /** Every account's rows as placed. The ref leads what is drawn. */
    ids: Record<string, string[]>;
    /** The same, as the drag found it: for Escape, and for "nothing moved". */
    before: Record<string, string[]>;
    /** Where the pointer is, and how far down the row it took hold.
     *  `pointerX` is only for re-asking what is under it while the view scrolls
     *  under a pointer that has stopped moving. */
    pointerX: number;
    pointerY: number;
    grab: number;
    /** What scrolls when the row is carried to the edge: the main column from
     *  md, the page below it. Resolved once, when the drag starts. */
    scroller: HTMLElement | null;
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

  /** Put the dragged row in `accountId`, beside `overId`, or at its end. */
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

  // Ticking rows, and copying them onto another sheet. See ./use-sheet-clipboard.
  const { toggle, clearTicks, marked, isTicked, copySelection } = useSheetClipboard({
    accounts: cc.accounts,
    linesOf,
    sheetRef,
    // Read when a key arrives, not when this renders: the listener is on the
    // document and outlives any one render of the sheet.
    isEditing: () => cellEdit.className.includes("is-editing"),
    clip,
    onCopy,
    canPaste: isAdmin,
    onPaste: (c, accountId) =>
      // Only this sheet's accounts change, so only those are taken from the
      // answer: the cost centre it is linked to is the page's own, and the
      // response has no opinion about the result unit derived from it.
      api(
        `/api/budgets/${budgetId}/cost-centers/${cc.id}/paste`,
        "POST",
        c.kind === "accounts" ? { accountIds: c.ids } : { accountId, lineItemIds: c.ids },
        (b, data) => withSheet(b, cc.id, (sheet) => ({ ...sheet, accounts: (data as BudgetCC).accounts })),
      ),
    notify,
    t,
  });

  // Just the cell layer now. The sheet's own ⌘C/⌘V used to wrap this handler,
  // which meant they were only heard while something inside the sheet had
  // focus; they are on the document now. See use-sheet-clipboard.
  const sheetProps = cellEdit;

  /** The tick box in the margin, on every row that can be copied. The app's own
   *  square, the one the multi-select picker marks its options with. */
  function tickBox(kind: "rows" | "accounts", id: string, label: string) {
    return (
      <Checkbox checked={isTicked(kind, id)} onChange={() => toggle(kind, id)} label={label} />
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
      pointerX: e.clientX,
      pointerY: e.clientY,
      grab: e.clientY - tr.getBoundingClientRect().top,
      scroller: verticalScroller(tr),
    };
    setPlacement(ids);
    setDraggingLineId(li.id);
  }

  // Put the row back under the pointer once the rows have been redrawn around
  // it, before the frame is painted, so the two never disagree on screen.
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
    /**
     * Where the row would land, given where the pointer is.
     *
     * Taken out of `move` because the frame loop below needs it too: while the
     * view scrolls under a pointer that has stopped, different rows arrive
     * under it and there is no pointer event coming to say so.
     */
    const resolve = (d: LineDrag) => {
      // What is under the pointer, asked of the page rather than worked out:
      // the lifted row is `pointer-events-none`, so this sees the sheet it is
      // being carried over. A heading or a Summa is nothing to land on, and the
      // placement simply stands until the pointer is over a row again.
      const under = document.elementFromPoint(d.pointerX, d.pointerY) as HTMLElement | null;
      const over = under?.closest<HTMLElement>("tr[data-line]");
      const end = under?.closest<HTMLElement>("tr[data-line-end]");
      if (over?.dataset.line && over.dataset.account && over.dataset.line !== d.id) {
        const box = over.getBoundingClientRect();
        place(d, over.dataset.account, over.dataset.line, d.pointerY > box.top + box.height / 2);
      } else if (end?.dataset.lineEnd) {
        // The new-row line, under the last of an account's rows, and the only
        // thing to aim at in an account that has none.
        place(d, end.dataset.lineEnd, null, false);
      }
      lift();
    };

    const move = (e: PointerEvent) => {
      const d = lineDrag.current;
      if (!d) return;
      d.pointerX = e.clientX;
      d.pointerY = e.clientY;
      resolve(d);
    };

    /**
     * Carrying a row to the edge scrolls the view.
     *
     * A frame loop rather than something hung off `move`: the pointer stops at
     * the edge of the screen and there are no more events, which is exactly the
     * moment the view has to keep going. Somewhere further down the sheet is
     * where the row is being taken, and without this it can only be dropped
     * where the screen already happened to show.
     *
     * The placement is redone only on a frame that actually moved. At the end of
     * the list the scroll does nothing, and re-asking what is under a
     * stationary pointer over a stationary sheet would be the same answer at
     * 60Hz for as long as somebody holds the row there.
     */
    let frame = 0;
    const tick = () => {
      const d = lineDrag.current;
      if (d && autoScrollStep(d.scroller, d.pointerY)) resolve(d);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    // Saved once, when it is let go, not on every row it crossed on the way.
    // One request even when the row changed account: the rows it left keep the
    // order they had, and the route moves it over (see the reorder endpoint).
    //
    // The arrangement was this screen's to begin with, so it is also what the
    // budget is patched with. `withLineOrder` is the same rule the route
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
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", key);
    };
  }, [draggingLineId, api, lift, place]);


  // A whole account only the other side has: it is budgeted for (or was spent
  // on) over there and not at all here. Shown in full, read-only, so the gap is
  // legible down to the row. This is the case a left join would have hidden.

  // The "+ new account" row at the foot of a section. One picker over the chart,
  // and the name follows from the account, so there is nothing else to type.

  // One section (income / costs) as its own rounded card. The whole card
  // is a drop zone: dropping an account row here flips it to this kind.

  // Written once and drawn twice. The strip on a phone and the tiles above md
  // must never be able to disagree about what the sheet comes to.
  const summary = [
    { label: t("totalIncome"), v: totals.income, a: compareTotals.income, incomeLike: true, signed: false, impact: undefined as number | undefined },
    { label: t("totalCosts"), v: totals.cost, a: compareTotals.cost, incomeLike: false, signed: false, impact: undefined as number | undefined },
    { label: tRam("result"), v: totals.result, a: compareTotals.result, signed: true, incomeLike: true, impact: changeImpact },
  ];

  // Everything the rows below need, gathered once. The sheet is four nested
  // levels of table and every one of them asks the same questions, so they ask
  // this rather than being handed forty-odd props each. See ./sheet-context.
  const sheet: SheetValue = {
    cc, ccCode, budgetId, columns, grid, ev, accounts, adjustments, compare, showCompare,
    isAdmin, canComment, userId,
    renderCell, renderFormula, api, date,
    narrow, gut, del, actualPad, totalCols, gutWidth: GUT_W, actionsWidth: ACT_W, staticWidth,
    t, tCol, tRam, tChanges, tAlloc, tBook, tLedger,
    income, cost, totals, compareTotals, compareAccounts, changeImpact,
    badAccount, badLine, liUrl, accountOptionsFor,
    isTicked, marked, tickBox,
    draggingLineId, liftRef, linesOf, startLineDrag,
    draft, setDraft, createLine, createAccount,
    openComments, setOpenComments, commentDraft, setCommentDraft,
  };

  return (
    <SheetProvider value={sheet}>
      <div ref={sheetRef} {...sheetProps}>
        {/* summary: the same three figures in two shapes.
            Not a <Card>, on purpose and for the same reason the sheets below
            don't look like the rest of the app: no shadow, and the figures in the
            sheet's own flat notation rather than the app's Amount (see DESIGN.md
            → Money). A tile carries three things a stat card doesn't: the
            compared side, the difference from it, and how far the editorial
            changes have moved the result. */}

        {/* On a phone: one strip, pinned under the app bar.
            The tiles this replaced auto-fit at `minmax(200px, 1fr)`, which on
            361px of screen is one column, so the three tiles stacked to
            266-362px, and most of the
            first screenful of a budget was three numbers. Here they are 56px, and
            they stay on screen while you scroll the rows that decide them, which
            is when the result is actually worth looking at. What the tiles said
            underneath, the compared side and what the changes have done, is one
            tap down rather than always printed. */}
        {/* Two elements, not one: the sticky layer is square and opaque, the
            card inside it is rounded. Pinning the rounded box itself left its
            four corner arcs transparent, and the rows scrolling under the strip
            showed through them. `bg-canvas` is the page's own colour, so the
            arcs read exactly as they do at rest. */}
        <div className="sticky top-14 z-10 bg-canvas md:hidden">
          <div className="rounded-panel border border-border bg-background shadow-[var(--shadow-card)]">
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
                        {s.label} - {compare.label}
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
                    assumed. Off, the sheet fits; on, it scrolls sideways, which is
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
        </div>

        {/* From md: one strip of three cells, each label on its figure's
            line and whatever qualifies the figure (the compared side, what the
            changes have done) on one small line under it. They were three
            tiles, label over figure with the comparison stacked under a rule,
            and with a comparison on that came to some 120px of header above
            every sheet for three numbers. */}
        <div className="hidden grid-cols-3 divide-x divide-border rounded-panel border border-border bg-background md:grid">
          {summary.map((s) => (
            <div key={s.label} className="min-w-0 px-4 py-2.5">
              <p className="flex items-baseline justify-between gap-3">
                {/* With a comparison on, the figure is said to be the budget's,
                    since the line under it carries another one. */}
                <span className="truncate text-xs text-muted">
                  {compare ? tGroup("ofBudget", { label: s.label }) : s.label}
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
              {/* The compared figure and the gap to it, each with its name:
                  run together they read as "Utfall 2026 −3 000+4 546". */}
              {compare && (
                <p className="mt-1 flex items-baseline justify-between gap-3 text-xs">
                  <span className="truncate text-muted">{compare.label}</span>
                  <span className="shrink-0 tabular-nums">
                    {fmt(s.a)}
                    <span
                      className={cn("ml-2", diffClass(s.a - s.v, s.incomeLike))}
                      title={tGroup("diffHint")}
                    >
                      {fmtSigned(s.a - s.v)}
                    </span>
                  </span>
                </p>
              )}
              {/* The result is the one in force; this is how far it has moved
                  from the adopted one, and in which direction. */}
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

        {/* What is ticked, and what it can be made into. It appears only once
            something is, so the sheet is as quiet as it was until you start. */}
        {isAdmin && (marked.rows.length > 0 || marked.accounts.length > 0) && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-panel border border-border bg-surface px-4 py-2 text-sm">
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
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-panel border border-accent/40 bg-accent-soft/40 px-4 py-2 text-sm">
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

        <SectionCard
          kind="INCOME"
          label={tRam("income")}
          accts={income}
          ghosts={ghostAccounts.filter((a) => a.kind === "INCOME")}
          total={totals.income}
        />
        <SectionCard
          kind="COST"
          label={tRam("costs")}
          accts={cost}
          ghosts={ghostAccounts.filter((a) => a.kind === "COST")}
          total={totals.cost}
        />
      </div>
    </SheetProvider>
  );
}
