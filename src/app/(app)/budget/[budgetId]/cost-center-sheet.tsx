// The per-cost-centre sheet: income and costs as two cards of account, line-item and Summa
// rows. Owns the drag handlers and per-sheet drafts; select/edit comes from useCellEdit.
import { Button } from "@/components/ui/button";
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
import { withLine, withLineOrder, withNewAccount, withSheet } from "./patch-budget";
import { useCellEdit } from "./use-cell-edit";
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
  // Left margin: the row number and the copy tick box share one cell. The box is centred and
  // the number overlaid out of flow so the boxes line up. `table-fixed` sizes from the
  // colgroup, so a 0px column with padded cells overflows into its neighbour; on a phone the
  // cell is emptied instead.
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

  // Row delete, revealed on hover or keyboard focus.
  const del = (onClick: () => void, label: string) => (
    <IconButton tone="danger" reveal onClick={onClick} label={label}>
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
  const GUT_W = narrow ? 0 : 58,
    ACT_W = narrow ? 40 : 78;
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

  async function createLine(accountId: string) {
    const d = newRow[accountId];
    if (!d || (!d.description.trim() && !d.expression.trim())) return;
    // The route returns the row it made, so no re-read of the budget is needed.
    const ok = await api(
      `/api/budget-accounts/${accountId}/line-items`,
      "POST",
      { description: d.description.trim(), expression: d.expression.trim() || "0" },
      (b, data) => withLine(b, accountId, data as LineItem),
    );
    if (ok)
      setNewRow((m) => {
        const n = { ...m };
        delete n[accountId];
        return n;
      });
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
   * HTML5, which can only snap) like components/voucher-editor.tsx: the row follows the
   * pointer and others snap into its gap. Geometry is measured, not counted in row heights,
   * since headings, Summa and new-row lines sit between accounts. Reclassifying a whole
   * account by dropping it on the other section is still HTML5.
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
    // Held inside the sheet's rows.
    const rows = sheetRef.current?.querySelectorAll<HTMLElement>("tr[data-line]");
    if (rows && rows.length > 0) {
      const top = rows[0].getBoundingClientRect().top;
      const bottom = rows[rows.length - 1].getBoundingClientRect().bottom;
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
      // Asked of the page: the lifted row is `pointer-events-none`. A heading or Summa is
      // nothing to land on, so the placement stands.
      const under = document.elementFromPoint(d.pointerX, d.pointerY) as HTMLElement | null;
      const over = under?.closest<HTMLElement>("tr[data-line]");
      const end = under?.closest<HTMLElement>("tr[data-line-end]");
      if (over?.dataset.line && over.dataset.account && over.dataset.line !== d.id) {
        const box = over.getBoundingClientRect();
        place(d, over.dataset.account, over.dataset.line, d.pointerY > box.top + box.height / 2);
      } else if (end?.dataset.lineEnd) {
        // The new-row line is the only target in an account with no rows.
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
    liftRef,
    linesOf,
    startLineDrag,
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
                    <p
                      key={s.label}
                      className="flex items-baseline justify-between gap-2 text-muted"
                    >
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

        {isAdmin && (marked.rows.length > 0 || marked.accounts.length > 0) && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-panel border border-border bg-surface px-4 py-2 text-sm">
            <span className="font-medium">
              {marked.accounts.length > 0
                ? t("markedAccounts", { count: marked.accounts.length })
                : t("markedRows", { count: marked.rows.length })}
            </span>
            <Button variant="link" type="button" onClick={copySelection} className="text-sm">
              {t("copyMarked")}
            </Button>
            <span className="text-xs text-muted">⌘/Ctrl+C</span>
            <Button variant="link" type="button" onClick={clearTicks} className="ml-auto text-xs">
              {t("clearMarked")}
            </Button>
          </div>
        )}

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
