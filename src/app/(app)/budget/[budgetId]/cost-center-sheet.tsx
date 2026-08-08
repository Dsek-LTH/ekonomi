// The per-cost-centre sheet: income / costs as two rounded cards, each an
// account → line-items → Summa table. Owns the drag-reclassify + row-reorder
// drag handlers and the per-sheet drafts; the select/edit behaviour comes from
// useCellEdit, and the cell renderers and `api` from the budget client.
import { useState } from "react";
import { useTranslations } from "next-intl";
import { effectiveKind, type AccountKind } from "@/lib/budget";
import { lineKeys, sheetTotals, ZERO_TOTALS, type JoinedAccount, type JoinedSheet } from "@/lib/budget/compare";
import { type BudgetGrid, type ColumnDef } from "@/lib/budget/grid";
import { useFormat } from "@/lib/ui/use-format";
import { cn } from "@/lib/ui/utils";
import { IconButton } from "@/components/ui/icon-button";
import { IconComment, IconTrash } from "@/components/ui/icons";
import { StatRow } from "./stat-row";
import { resultImpact } from "@/lib/budget/changes";

import { ccTotals, diffClass, fmt, fmtSigned, insideRect, type AdjustmentRow } from "./budget-helpers";
import { useCellEdit } from "./use-cell-edit";
import type { AccountRecord } from "@/lib/domain/types";
import { Combobox } from "@/components/ui/combobox";
import type { Account, BudgetCC, Evaluated, LineItem, Draft, CellFn, FormulaFn, ApiFn } from "./budget-types";

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
}) {
  const { cc, ccCode, ev, grid, columns, compare, isAdmin, canComment, userId, renderCell, renderFormula, api, budgetId, accounts, adjustments } = props;
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
  const gut = (n: number | undefined) => <td className="select-none border-r border-border/60 px-1 text-right align-top font-mono text-[10px] leading-8 text-muted/50">{n ?? ""}</td>;

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
  const showCompare = compare !== null;
  const compareTotals = compare ? sheetTotals(compare.sheet, 1) : ZERO_TOTALS;
  const compareAccounts = new Map((compare?.sheet.accounts ?? []).map((a) => [a.code, a]));
  const ownCodes = new Set(cc.accounts.map((a) => a.accountCode));
  const ghostAccounts = (compare?.sheet.accounts ?? []).filter((a) => !ownCodes.has(a.code));
  // Two empty trailing cells to keep non-Summa rows aligned when they show.
  const actualPad = showCompare ? <><td className="border-l border-border/40" /><td /></> : null;

  // Column geometry. The table is: gutter + every column (+ compare + diff) + action.
  const totalCols = columns.length + 2 + (showCompare ? 2 : 0); // full-width spanners (comments)
  const liUrl = (id: string) => `/api/budget-line-items/${id}`;

  // Fixed widths; Beskrivning is left elastic so it fills the row. The table is
  // w-full, so it always fits its container with no horizontal scrollbar.
  // The action column holds a trash icon on every row, plus the comment toggle
  // (icon + count) on account rows — wide enough for both without wrapping.
  const GUT_W = 40, ACT_W = 78;
  const staticWidth = (c: ColumnDef): number | undefined =>
    c.key === "beskrivning" ? undefined : c.key === "konto" ? 110 : 260;

  // One line-item cell, rendered per column.
  function lineCell(col: ColumnDef, li: LineItem) {
    const k = col.key;
    if (k === "konto") return (
      <td key={k} className="border-r border-border/60 p-0">
        {isAdmin && (
          <span
            draggable
            onDragStart={(e) => { e.dataTransfer.setData("lineId", li.id); e.dataTransfer.effectAllowed = "move"; }}
            className="flex cursor-grab select-none items-center px-1.5 py-1.5 text-muted/30 opacity-0 transition-opacity hover:text-muted active:cursor-grabbing group-hover:opacity-100"
            title={t("dragToReorder")}
          >⠿</span>
        )}
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
    const ok = await api(`/api/budget-accounts/${accountId}/line-items`, "POST", {
      description: d.description.trim(),
      expression: d.expression.trim() || "0",
    });
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
    // The name is resolved server-side from the chart.
    await api(`/api/budgets/${budgetId}/cost-centers/${cc.id}/accounts`, "POST", {
      accountCode: code.trim(), kindOverride: kind,
    });
  }

  // Dropping an account card flips its income/cost classification. Gated on the
  // "accountid" drag payload so it ignores line-row drags (which carry "lineid").
  const dropProps = (kind: AccountKind) => ({
    onDragOver: (e: React.DragEvent) => { if (!e.dataTransfer.types.includes("accountid")) return; e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (dropKind !== kind) setDropKind(kind); },
    onDragLeave: (e: React.DragEvent) => { if (insideRect(e)) return; setDropKind((k) => (k === kind ? null : k)); },
    onDrop: (e: React.DragEvent) => { if (!e.dataTransfer.types.includes("accountid")) return; e.preventDefault(); setDropKind(null); const id = e.dataTransfer.getData("accountId"); if (id) api(`/api/budget-accounts/${id}`, "PATCH", { kindOverride: kind }); },
  });

  // Which line row is the current drop target (for the insert highlight).
  const [dropLineId, setDropLineId] = useState<string | null>(null);

  // Reorder a line within its account: drop `draggedId` at `targetId`'s slot.
  // Same-account only; cross-account ids are ignored by the endpoint.
  function reorderLine(account: Account, draggedId: string, targetId: string) {
    if (draggedId === targetId) return;
    if (!account.lineItems.some((l) => l.id === draggedId)) return; // not this account's row
    const ids = account.lineItems.map((l) => l.id).filter((id) => id !== draggedId);
    const idx = ids.indexOf(targetId);
    if (idx === -1) return;
    ids.splice(idx, 0, draggedId);
    api(`/api/budget-accounts/${account.id}/line-items/reorder`, "POST", { orderedIds: ids });
  }
  const lineDropProps = (account: Account, li: LineItem) => ({
    onDragOver: (e: React.DragEvent) => { if (!e.dataTransfer.types.includes("lineid")) return; e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = "move"; if (dropLineId !== li.id) setDropLineId(li.id); },
    onDragLeave: (e: React.DragEvent) => { if (insideRect(e)) return; setDropLineId((k) => (k === li.id ? null : k)); },
    onDrop: (e: React.DragEvent) => { if (!e.dataTransfer.types.includes("lineid")) return; e.preventDefault(); e.stopPropagation(); setDropLineId(null); reorderLine(account, e.dataTransfer.getData("lineId"), li.id); },
  });

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
    const keys = lineKeys(account.lineItems);
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
        <tr className="group bg-background">
          {gut(grid.accountRow.get(`${ccCode}|${account.id}`))}
          <td className="group relative border-r border-border/60 bg-brand p-0 align-middle">
            {isAdmin && (
              <span
                draggable
                onDragStart={(e) => { e.dataTransfer.setData("accountId", account.id); e.dataTransfer.effectAllowed = "move"; }}
                className="pointer-events-none absolute inset-y-0 left-0 z-10 flex cursor-grab select-none items-center px-1.5 text-on-brand/60 opacity-0 transition-opacity hover:text-on-brand active:cursor-grabbing group-hover:pointer-events-auto group-hover:opacity-100"
                title={t("dragToSection")}
              >⠿</span>
            )}
            {isAdmin ? (
              <Combobox
                options={accountOptionsFor(account.accountCode)}
                value={account.accountCode}
                onChange={(v) => {
                  if (v !== account.accountCode) {
                    api(`/api/budget-accounts/${account.id}`, "PATCH", { accountCode: v });
                  }
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
              {isAdmin && del(() => api(`/api/budget-accounts/${account.id}`, "DELETE"), t("removeAccount"))}
            </span>
          </td>
        </tr>

        {account.lineItems.map((li, i) => (
          <tr
            key={li.id}
            {...lineDropProps(account, li)}
            className={cn("group border-t transition-colors hover:bg-surface/40", dropLineId === li.id ? "border-t-2 border-t-accent" : "border-border/40")}
          >
            {gut(grid.lineRow.get(`${ccCode}|${li.id}`))}
            {columns.map((col) => lineCell(col, li))}
            {showCompare && (
              <CompareCells other={cmpLines.get(keys[i])?.values[1]} own={ev.lineItems[li.id]} incomeLike={incomeLike} />
            )}
            <td className="px-1 text-left text-muted">
              {isAdmin && del(() => api(liUrl(li.id), "DELETE"), tAlloc("removeRow"))}
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
          <tr className="border-t border-border/40 bg-background">
            <td className="w-9 border-r border-border/60" />
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
                      <span className="shrink-0">{del(() => api(`/api/budget-comments/${cm.id}`, "DELETE"), t("removeComment"))}</span>
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
                      const ok = await api(`/api/budget-accounts/${account.id}/comments`, "POST", { body });
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
              <th className="select-none border-r border-border/60 px-1 py-2 text-center font-mono text-[10px] text-muted/50">#</th>
              {columns.map((col) => (
                <Hc key={col.key} letter={col.letter} align={col.kind === "number" ? "right" : undefined}>{col.custom ? col.name : tCol(col.name)}</Hc>
              ))}
              {compare && <th className="border-l border-border/60 px-2 py-2 text-right font-medium">{compare.label}</th>}
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

  return (
    <div {...cellEdit}>
      {/* summary — StatRow's auto-fit, so the three drop to one column on a
          phone instead of squeezing six-figure amounts into a third of it.
          Not a <Card>, on purpose and for the same reason the
          sheets below don't look like the rest of the app: no shadow, and the
          figures in the sheet's own flat notation rather than the app's Amount
          (see DESIGN.md → Money). A tile here carries three things a stat card
          doesn't — the compared side, the difference from it, and how far the
          editorial changes have moved the result — so it is written out. */}
      <StatRow>
        {[
          { label: t("totalIncome"), v: totals.income, a: compareTotals.income, incomeLike: true },
          { label: t("totalCosts"), v: totals.cost, a: compareTotals.cost, incomeLike: false },
          { label: tRam("result"), v: totals.result, a: compareTotals.result, signed: true, incomeLike: true, impact: changeImpact },
        ].map((s) => (
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
