// The per-cost-centre sheet: income and costs as two cards of account, line-item and Summa
// rows. Owns the drag handlers and per-sheet drafts; select/edit comes from useCellEdit.
import { Button } from "@/components/ui/button";
import { SelectionBar } from "@/components/selection-bar";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { effectiveKind, isResultAccount, type AccountKind } from "@/lib/budget";
import { sheetTotals, ZERO_TOTALS, type JoinedSheet } from "@/lib/budget/compare";
import { toStored, type BudgetGrid, type ColumnDef } from "@/lib/budget/grid";
import { autoScrollStep, verticalScroller } from "@/lib/ui/auto-scroll";
import { useFormat } from "@/lib/ui/use-format";
import { usePhone } from "@/lib/ui/media";
import { cn } from "@/lib/ui/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { IconButton } from "@/components/ui/icon-button";
import { IconTrash } from "@/components/ui/icons";
import { resultImpact } from "@/lib/budget/changes";

import {
  ccTotals,
  diffClass,
  fmt,
  fmtSigned,
  normalizeFormula,
  type AdjustmentRow,
} from "./budget-helpers";
import { withLine, withLineOrder, withNewAccount, withSheet } from "./patch-budget";
import { useCellEdit } from "./use-cell-edit";
import type { UndoStep } from "./use-undo";
import { useSheetClipboard } from "./use-sheet-clipboard";
import { SheetProvider, type SheetValue } from "./sheet-context";
import { SectionCard } from "./sheet-section";
import { useNotify } from "@/components/shell/notifications";
import type { AccountRecord } from "@/lib/domain/types";
import type {
  Account,
  BudgetCC,
  BudgetClip,
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
}

// How far the pointer moves on the grip before a row lifts. Below it the press is a click.
const DRAG_THRESHOLD_PX = 4;

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

  const cellEdit = useCellEdit("space-y-4");
  const notify = useNotify();

  // Sheet-local UI state: accounts with comments expanded, and drafts for the new-row inputs.
  const [openComments, setOpenComments] = useState<Set<string>>(new Set());
  const [commentDraft, setCommentDraft] = useState<Record<string, string>>({});
  const [newRow, setNewRow] = useState<Record<string, Draft>>({});

  const badLine = new Set(ev.badLineItems);
  const badAccount = new Set(ev.badAccounts);
  // Accounts whose total is short a row that did not resolve (the figure is the sum of the rest).
  // Left margin: the row number, which gives way to the copy tick box when the row is pointed
  // at or the box has focus, and to every box while anything is ticked (as in a mail list).
  // Faded, not hidden, so the box stays in the tab order. `table-fixed` sizes from the
  // colgroup, so a 0px column with padded cells overflows into its neighbour; on a phone the
  // cell is emptied instead. Reads `marked` at render, after the clipboard hook below.
  const gut = (n: number | undefined, box?: React.ReactNode) => {
    if (narrow) return <td className="p-0" />;
    const anyTicked = marked.rows.length > 0 || marked.accounts.length > 0;
    const hasBox = Boolean(box);
    return (
      <td className="group/gut relative select-none border-r border-border/60 px-1 align-middle">
        <span
          className={cn(
            "absolute inset-0 flex items-center justify-center text-[11px] tabular-nums text-faint",
            hasBox &&
              (anyTicked ? "invisible" : "group-hover:invisible group-focus-within/gut:invisible"),
          )}
        >
          {n ?? ""}
        </span>
        <span
          className={cn(
            "relative flex h-7 items-center justify-center",
            hasBox &&
              !anyTicked &&
              "opacity-0 group-hover:opacity-100 group-focus-within/gut:opacity-100",
          )}
        >
          {box}
        </span>
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

  const totalCols = columns.length + 2 + (showCompare ? 2 : 0); // full-width spanners (comments)
  const liUrl = (id: string) => `/api/budget-line-items/${id}`;

  // Fixed widths; Beskrivning is elastic. On a phone (361px) the desktop set leaves
  // Beskrivning nothing, so chrome shrinks: gutter 58 to 0 (drag is not usable on touch),
  // konto 110 to 26 (just the elbow), belopp 260 to 110 (equation is shown on tap, see
  // `compact` in use-budget-cells.tsx), action 78 to 40 (one icon).
  // The margin holds one thing at a time (number or tick box); the actions a comment and a delete.
  const GUT_W = narrow ? 0 : 36,
    ACT_W = narrow ? 40 : 60;
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
   * Reordering a line by hand, within its account or onto another one. A pointer drag (not
   * HTML5, which can only snap) like components/voucher-editor.tsx: the row glides under the
   * pointer and others snap into its gap. The sheet's table keeps separate borders
   * (sheet-section.tsx) so a carried row takes its column rules with it.
   * Reclassifying a whole account by dropping it on the other section is still HTML5.
   */
  interface LineDrag {
    id: string;
    fromAccountId: string;
    accountId: string;
    ids: Record<string, string[]>;
    before: Record<string, string[]>;
    /** Pointer position; `pointerX` is for re-asking what is under it while the view scrolls. */
    pointerX: number;
    pointerY: number;
    grab: number;
    /** What scrolls when the row is carried to the edge, resolved at drag start. */
    scroller: HTMLElement | null;
  }
  const lineDrag = useRef<LineDrag | null>(null);
  const [draggingLineId, setDraggingLineId] = useState<string | null>(null);
  // The placement to draw: the drag's while in the air, and until the saved sheet returns
  // (else the sheet would spring back during the save).
  const [placement, setPlacement] = useState<Record<string, string[]> | null>(null);
  const liftRef = useRef<HTMLTableRowElement | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  // Every row by id, since a placement can hold a row carried out of its server account.
  const lineById = new Map(cc.accounts.flatMap((a) => a.lineItems.map((l) => [l.id, l] as const)));

  function linesOf(account: Account): LineItem[] {
    const ids = placement?.[account.id];
    if (!ids) return account.lineItems;
    return ids.map((id) => lineById.get(id)).filter((l): l is LineItem => Boolean(l));
  }

  /** Keep the lifted row under the pointer. Written to the node, since a state update per pixel would re-render the sheet. */
  const lift = useCallback(() => {
    const el = liftRef.current;
    const d = lineDrag.current;
    if (!el || !d) return;
    el.style.transform = "";
    const box = el.getBoundingClientRect();
    let y = d.pointerY - d.grab - box.top;
    // Held inside the accounts, headings and Summa included. Not inside the line rows: with
    // every account above it empty, the dragged row is the first line row and could not rise.
    const zones = sheetRef.current?.querySelectorAll<HTMLElement>("tbody[data-drop-account]");
    if (zones && zones.length > 0) {
      const top = zones[0].getBoundingClientRect().top;
      const bottom = zones[zones.length - 1].getBoundingClientRect().bottom;
      y = Math.min(Math.max(y, top - box.top), bottom - box.height - box.top);
    }
    el.style.transform = `translateY(${y}px)`;
  }, []);

  const place = useCallback(
    (d: LineDrag, accountId: string, overId: string | null, after: boolean) => {
      const ids: Record<string, string[]> = {};
      for (const [key, list] of Object.entries(d.ids)) ids[key] = list.filter((x) => x !== d.id);
      const list = ids[accountId];
      if (!list) return;
      const at = overId ? list.indexOf(overId) : -1;
      list.splice(at === -1 ? list.length : at + (after ? 1 : 0), 0, d.id);
      if (accountId === d.accountId && list.join() === d.ids[accountId].join()) return;
      d.ids = ids;
      d.accountId = accountId;
      setPlacement(ids);
    },
    [],
  );

  const { toggle, clearTicks, marked, isTicked, copySelection } = useSheetClipboard({
    accounts: cc.accounts,
    linesOf,
    sheetRef,
    // Read when a key arrives: the document listener outlives any one render.
    isEditing: () => cellEdit.className.includes("is-editing"),
    clip,
    onCopy,
    canPaste: isAdmin,
    onPaste: (c, accountId) =>
      // Only this sheet's accounts are taken from the answer.
      api(
        `/api/budgets/${budgetId}/cost-centers/${cc.id}/paste`,
        "POST",
        c.kind === "accounts" ? { accountIds: c.ids } : { accountId, lineItemIds: c.ids },
        (b, data) =>
          withSheet(b, cc.id, (sheet) => ({
            ...sheet,
            accounts: (data as BudgetCC).accounts,
          })),
      ),
    notify,
    t,
  });

  const sheetProps = cellEdit;

  /** The tick box in the margin, on every row that can be copied. */
  function tickBox(kind: "rows" | "accounts", id: string, label: string) {
    return (
      <Checkbox checked={isTicked(kind, id)} onChange={() => toggle(kind, id)} label={label} />
    );
  }

  function startLineDrag(e: React.PointerEvent, account: Account, li: LineItem) {
    if (!isAdmin || e.button !== 0) return;
    const tr = (e.target as HTMLElement).closest("tr");
    if (!tr) return;
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const grab = startY - tr.getBoundingClientRect().top;
    // Lifted only once the pointer has moved, so a click on the grip does not flash the
    // lifted row (outline and fill) on and off.
    const move = (ev: PointerEvent) => {
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD_PX) return;
      done();
      const ids: Record<string, string[]> = {};
      for (const a of cc.accounts) ids[a.id] = linesOf(a).map((l) => l.id);
      lineDrag.current = {
        id: li.id,
        fromAccountId: account.id,
        accountId: account.id,
        ids,
        before: ids,
        pointerX: ev.clientX,
        pointerY: ev.clientY,
        grab,
        scroller: verticalScroller(tr),
      };
      setPlacement(ids);
      setDraggingLineId(li.id);
    };
    const done = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", done);
      window.removeEventListener("pointercancel", done);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", done);
    window.addEventListener("pointercancel", done);
  }

  // Put the row back under the pointer after the rows redraw, before paint.
  useLayoutEffect(() => {
    if (draggingLineId) lift();
  }, [placement, draggingLineId, lift]);

  // Followed on the window: the pointer leaves the grip quickly.
  useEffect(() => {
    if (!draggingLineId) return;
    const clear = () => {
      if (liftRef.current) liftRef.current.style.transform = "";
      liftRef.current = null;
      lineDrag.current = null;
      setDraggingLineId(null);
    };
    /** Where the row would land. Shared with the frame loop, since scrolling brings new rows under a stationary pointer. */
    const resolve = (d: LineDrag) => {
      // Asked of the page: the lifted row is `pointer-events-none`.
      const under = document.elementFromPoint(d.pointerX, d.pointerY) as HTMLElement | null;
      const over = under?.closest<HTMLElement>("tr[data-line]");
      const zone = under?.closest<HTMLElement>("tbody[data-drop-account]")?.dataset.dropAccount;
      if (over) {
        if (over.dataset.line !== d.id && over.dataset.account) {
          const box = over.getBoundingClientRect();
          place(d, over.dataset.account, over.dataset.line!, d.pointerY > box.top + box.height / 2);
        }
      } else if (zone) {
        // The rest of an account is split at its rows: the heading takes the row first, and
        // anything under the rows (Summa, the new-row line) takes it last. The boundary
        // between two accounts is then the same going up as going down.
        const head = under?.closest("tr[data-account-row]");
        const first = (d.ids[zone] ?? []).find((x) => x !== d.id) ?? null;
        place(d, zone, head ? first : null, false);
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
     * Carrying a row to the edge scrolls the view, in a frame loop since a stationary pointer
     * sends no events. Placement is redone only on a frame that actually scrolled.
     */
    let frame = 0;
    const tick = () => {
      const d = lineDrag.current;
      if (d && autoScrollStep(d.scroller, d.pointerY)) resolve(d);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    // Saved once on drop, in one request even across accounts (see the reorder endpoint).
    // `withLineOrder` is the route's own rule; the placement stands until the save lands.
    const stop = () => {
      const d = lineDrag.current;
      const to = d?.accountId;
      const moved = d && to && (to !== d.fromAccountId || d.ids[to].join() !== d.before[to].join());
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

  // An account only the other side has, shown read-only so the gap is visible.

  // One section as a card; the whole card is a drop zone that flips a dropped account's kind.

  // Drawn twice (phone strip, md tiles) from one place so they cannot disagree.
  const summary = [
    {
      label: t("totalIncome"),
      v: totals.income,
      a: compareTotals.income,
      incomeLike: true,
      signed: false,
      impact: undefined as number | undefined,
    },
    {
      label: t("totalCosts"),
      v: totals.cost,
      a: compareTotals.cost,
      incomeLike: false,
      signed: false,
      impact: undefined as number | undefined,
    },
    {
      label: tRam("result"),
      v: totals.result,
      a: compareTotals.result,
      signed: true,
      incomeLike: true,
      impact: changeImpact,
    },
  ];

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
    isTicked,
    marked,
    tickBox,
    draggingLineId,
    linesOf,
    startLineDrag,
    liftRef,
    draft,
    setDraft,
    createLine,
    createAccount,
    openComments,
    setOpenComments,
    commentDraft,
    setCommentDraft,
  };

  return (
    <SheetProvider value={sheet}>
      <div ref={sheetRef} {...sheetProps}>
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
                            diffClass(s.a - s.v, s.incomeLike),
                          )}
                        >
                          {fmtSigned(s.a - s.v)}
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
                    className="text-xs font-medium text-link"
                  >
                    {compareOnPhone ? t("hideCompareColumns") : t("showCompareColumns")}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="hidden grid-cols-3 divide-x divide-border rounded-panel border border-border bg-background md:grid">
          {summary.map((s) => (
            <div key={s.label} className="min-w-0 px-4 py-2.5">
              <p className="flex items-baseline justify-between gap-3">
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
              {/* Name each figure, or they run together. */}
              {compare && (
                <>
                  <p className="mt-1 flex items-baseline justify-between gap-3 text-xs">
                    <span className="truncate text-muted">{compare.label}</span>
                    <span className="shrink-0 tabular-nums">{fmt(s.a)}</span>
                  </p>
                  <p
                    className="mt-1 flex items-baseline justify-between gap-3 text-xs"
                    title={tGroup("diffHint")}
                  >
                    <span className="truncate text-muted">{tGroup("diff")}</span>
                    <span
                      className={cn("shrink-0 tabular-nums", diffClass(s.a - s.v, s.incomeLike))}
                    >
                      {fmtSigned(s.a - s.v)}
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

        {/* What can be done with the ticked rows, floating at the foot of the screen as on the
            other lists (SelectionBar). Accounts win, as a copy takes them over their rows. */}
        {isAdmin && (
          <SelectionBar
            count={marked.accounts.length || marked.rows.length}
            label={(count) =>
              marked.accounts.length > 0
                ? t("markedAccounts", { count })
                : t("markedRows", { count })
            }
          >
            <Button variant="quiet" onClick={clearTicks}>
              {t("clearMarked")}
            </Button>
            <Button onClick={copySelection} title="⌘/Ctrl+C">
              {t("copyMarked")}
            </Button>
          </SelectionBar>
        )}

        {/* What the page's clipboard holds: a status, not a choice, so neutral. */}
        {isAdmin && clip && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-panel border border-border bg-surface px-4 py-2 text-sm">
            <span className="font-medium">
              {clip.kind === "rows"
                ? t("copiedRows", { count: clip.ids.length })
                : t("copiedAccountCode", { code: clip.label })}
            </span>
            <span className="text-xs text-muted">
              {clip.kind === "rows" ? t("pasteRowsHint") : t("pasteAccountsHint")}
            </span>
            <Button
              variant="link"
              type="button"
              onClick={() => onCopy(null)}
              className="ml-auto text-xs"
            >
              {t("clearClipboard")}
            </Button>
          </div>
        )}

        <SectionCard
          kind="INCOME"
          label={tRam("income")}
          accts={income}
          ghosts={ghostAccounts.filter((a) => a.kind === "INCOME")}
        />
        <SectionCard
          kind="COST"
          label={tRam("costs")}
          accts={cost}
          ghosts={ghostAccounts.filter((a) => a.kind === "COST")}
        />
      </div>
    </SheetProvider>
  );
}
