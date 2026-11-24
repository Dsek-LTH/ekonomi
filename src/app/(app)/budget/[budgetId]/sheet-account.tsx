"use client";

// One account on a budget sheet: header row, line items, the add row and comments. The
// sheet arrives as a context (./sheet-context) rather than as props.
import { effectiveKind, type AccountKind } from "@/lib/budget";
import { lineKeys, type JoinedAccount } from "@/lib/budget/compare";
import type { ColumnDef } from "@/lib/budget/grid";
import { cn } from "@/lib/ui/utils";
import { Combobox } from "@/components/ui/combobox";
import { DragHandle } from "@/components/ui/drag";
import { SOFT_FILL, TEXT_HOVER } from "@/components/ui/button";
import { IconComment } from "@/components/ui/icons";
import { fmt, fmtSigned } from "./budget-helpers";
import {
  withAccount,
  withComment,
  withoutAccount,
  withoutComment,
  withoutLine,
} from "./patch-budget";
import { CompareCells } from "./sheet-cells";
import { useSheet, type SheetValue } from "./sheet-context";
import type { Account, Comment, LineItem } from "./budget-types";

// Every budget column is ruled off on its right except Belopp, the last: the actions beside it
// are not a column of their own.
const rule = (col: ColumnDef) => (col.key === "expression" ? "" : "border-r border-border/60");

function lineCell(sheet: SheetValue, col: ColumnDef, li: LineItem, account: Account) {
  const {
    badLine,
    ccCode,
    draggingLineId,
    ev,
    isAdmin,
    liUrl,
    renderCell,
    renderFormula,
    startLineDrag,
    t,
    tCol,
  } = sheet;
  const k = col.key;
  if (k === "konto")
    return (
      // Empty on a row with no number of its own, but for the drag grip on hover. The indent in
      // Beskrivning already says which account the row belongs to.
      <td key={k} className="border-r border-border/60 p-0">
        <span className="flex items-center py-1 pl-1.5 pr-2">
          {isAdmin && (
            <DragHandle
              onPointerDown={(e) => startLineDrag(e, account, li)}
              className={cn(
                "flex items-center text-faint hover:text-muted",
                draggingLineId === li.id && "text-muted opacity-100",
              )}
              title={t("dragToReorder")}
            />
          )}
        </span>
      </td>
    );
  if (k === "beskrivning")
    return (
      <td key={k} className="border-r border-border/60 p-0">
        {renderCell({
          id: li.id,
          field: "description",
          actual: li.description,
          className: "pl-5",
          placeholder: tCol("beskrivning"),
          url: liUrl(li.id),
          payload: (v) => ({ description: v }),
          gated: true,
        })}
      </td>
    );
  const val = ev.lineItems[li.id];
  return (
    <td key={k} className="p-0 text-right">
      {renderFormula({
        id: li.id,
        field: "expression",
        raw: li.expression,
        computed: val,
        sheet: ccCode,
        bad: badLine.has(li.id),
        placeholder: "0",
        url: liUrl(li.id),
        payload: (v) => ({ expression: v }),
        gated: true,
      })}
    </td>
  );
}

export function AccountBlock({ account }: { account: Account }) {
  const sheet = useSheet();
  const {
    accountOptionsFor,
    accounts,
    actualPad,
    adjustments,
    api,
    record,
    badAccount,
    canComment,
    ccCode,
    columns,
    commentDraft,
    compareAccounts,
    createLine,
    date,
    del,
    draft,
    draggingLineId,
    ev,
    grid,
    gut,
    isAdmin,
    isTicked,
    liUrl,
    liftRef,
    linesOf,
    openComments,
    setCommentDraft,
    setDraft,
    setOpenComments,
    showCompare,
    t,
    tAlloc,
    tBook,
    tChanges,
    tCol,
    tickBox,
    totalCols,
    userId,
  } = sheet;
  const accountKey = `${ccCode}:${account.accountCode}`;
  const total = ev.accounts[accountKey];
  const totalIncomplete = badAccount.has(accountKey);
  const open = openComments.has(account.id);
  const d = draft(account.id);
  const incomeLike = effectiveKind(account.accountCode) === "INCOME";

  // The same account on the other side, matched on description (lineKeys): `keys[i]` is this
  // sheet's i-th row there, and what is left over is a row only they have.
  const cmp = compareAccounts.get(account.accountCode);
  // Off the rows as drawn: a dragged row's comparison travels with it.
  const lines = linesOf(account);
  const keys = lineKeys(lines);
  const cmpLines = new Map((cmp?.lines ?? []).map((l) => [l.key, l]));
  const ghostLines = (cmp?.lines ?? []).filter((l) => !keys.includes(l.key));

  // Editorial changes in force. They are already inside `total` (lib/budget/eval.ts); the
  // rows make the figure explicable.
  const adjRows = adjustments.get(account.id) ?? [];
  const adjTotal = adjRows.reduce((sum, r) => sum + r.amount, 0);
  // Read against something else, an account is one row: its number, name, budget and the
  // comparison. The utfall has nothing to say about a row (Fortnox books to an account).
  // Writing comes back with the comparison off.
  if (showCompare) {
    return (
      <tbody className="[&>tr:last-child>*]:border-b">
        <tr className="bg-background">
          {gut(grid.accountRow.get(`${ccCode}|${account.id}`))}
          <td className="border-r border-border/60 px-2 py-1 text-center text-sm font-semibold tabular-nums">
            {account.accountCode}
          </td>
          <td
            className="border-r border-border/60 px-3 py-1 text-sm font-medium"
            colSpan={columns.length - 2}
          >
            {account.accountName}
          </td>
          <td
            className={cn(
              "px-2 py-1 text-right font-semibold tabular-nums",
              totalIncomplete && "text-warning",
            )}
          >
            {fmt(total)}
          </td>
          <CompareCells other={cmp?.totals[1]} own={total} incomeLike={incomeLike} strong />
          <td />
        </tr>
      </tbody>
    );
  }

  return (
    // `data-drop-account`: the whole account is a drop zone for a dragged row (cost-center-sheet.tsx).
    <tbody
      data-drop-account={account.id}
      // Cells own their rules (separate borders, sheet-section.tsx), so the account's closing
      // rule is on its last row.
      className="[&>tr:last-child>*]:border-b"
    >
      {/* Tinted: each account opens with a band holding its name and total, which sets the
          accounts apart as the Summa row under each one used to. */}
      <tr data-account-row={account.id} className="group bg-surface">
        {gut(
          grid.accountRow.get(`${ccCode}|${account.id}`),
          isAdmin &&
            tickBox("accounts", account.id, t("selectAccount", { code: account.accountCode })),
        )}

        <td className="group relative border-r border-border/60 p-0 align-middle">
          {isAdmin ? (
            <Combobox
              // Its own side only: swapping 3010 for 5010 under Intäkter would move it mid-edit.
              options={accountOptionsFor(effectiveKind(account.accountCode), account.accountCode)}
              value={account.accountCode}
              onChange={(v) => {
                if (v === account.accountCode) return;
                // The code pulls the name with it (resolved from the chart), so take both from the
                // answer and nothing else, since the account's rows are not in it.
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
              // Plain text until pointed at: a number to read, not a form field.
              buttonClassName="px-2 py-1 text-sm font-semibold tabular-nums text-foreground"
              chevronClassName="text-faint opacity-0 transition-opacity group-hover:opacity-100"
              aria-label={t("accountNumber")}
            />
          ) : (
            <div className="px-2 py-1 text-center text-sm font-semibold tabular-nums text-foreground">
              {account.accountCode}
            </div>
          )}
        </td>
        <td className="border-r border-border/60 px-3 py-1 text-sm" colSpan={columns.length - 2}>
          <span className="flex items-baseline gap-2">
            <span className="min-w-0 truncate font-semibold">{account.accountName}</span>
            {adjTotal !== 0 && total !== undefined && (
              <span className="ml-auto shrink-0 text-xs text-muted">
                {t("originally", { amount: fmt(total - adjTotal) })}
              </span>
            )}
            {totalIncomplete && (
              <span className={cn("shrink-0 text-xs text-warning", adjTotal === 0 && "ml-auto")}>
                {t("incompleteSum")}
              </span>
            )}
          </span>
        </td>
        {/* The account's total on its own row, as a subtotal reads in a spreadsheet. */}
        <td
          className={cn(
            "px-2 py-1 text-right font-semibold tabular-nums",
            totalIncomplete && "text-warning",
            total !== undefined && total < 0 && !totalIncomplete && "text-danger",
          )}
        >
          {fmt(total)}
        </td>
        {showCompare && (
          <CompareCells other={cmp?.totals[1]} own={total} incomeLike={incomeLike} strong />
        )}
        <td className="whitespace-nowrap px-1 text-left text-xs text-muted">
          <span className="flex items-center">
            {canComment && (
              <button
                onClick={() =>
                  setOpenComments((s) => {
                    const n = new Set(s);
                    if (n.has(account.id)) n.delete(account.id);
                    else n.add(account.id);
                    return n;
                  })
                }
                title={t("comments")}
                aria-label={t("commentsCount", { count: account.comments.length })}
                aria-expanded={open}
                className={cn(
                  "flex items-center gap-1 rounded-control px-1 py-0.5 tabular-nums transition hover:text-foreground",
                  // Open is a chosen state: the pink hue. Otherwise a text button's faint pink hover.
                  open
                    ? SOFT_FILL
                    : cn(TEXT_HOVER, account.comments.length > 0 && "text-foreground"),
                  // An account with nothing said about it shows the button only when pointed at.
                  !open &&
                    account.comments.length === 0 &&
                    "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
                )}
              >
                <IconComment className="size-4" />
                {account.comments.length > 0 && account.comments.length}
              </button>
            )}
            {isAdmin &&
              del(
                () =>
                  api(`/api/budget-accounts/${account.id}`, "DELETE", undefined, (b) =>
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

          data-line={li.id}
          data-account={account.id}
          // Only set, never cleared: a row carried into another account is a new <tr> under a
          // new <tbody>, mounted around the time React drops the old one.
          ref={(el) => {
            if (el && draggingLineId === li.id) liftRef.current = el;
          }}
          className={cn(
            "group *:border-t transition-colors hover:bg-hover",
            // Lifted: opaque so rows do not read through it, and outlined. `pointer-events-none`
            // lets the drag see the sheet underneath. `transition-none`: transition-colors
            // animates outline-color too, from currentColor (near white in dark), which flashed.
            draggingLineId === li.id &&
              "pointer-events-none relative z-10 bg-background outline outline-1 outline-border transition-none",
            // Ticked for copying: chosen, so the pink hue rather than grey.
            isTicked("rows", li.id) && SOFT_FILL,
          )}
        >
          {gut(
            grid.lineRow.get(`${ccCode}|${li.id}`),
            isAdmin && tickBox("rows", li.id, t("selectRow")),
          )}
          {columns.map((col) => lineCell(sheet, col, li, account))}
          {showCompare && (
            <CompareCells
              other={cmpLines.get(keys[i])?.values[1]}
              own={ev.lineItems[li.id]}
              incomeLike={incomeLike}
            />
          )}
          <td className="px-1 text-left text-muted">
            {isAdmin &&
              del(() => {
                // The line as it stood, so ⌘Z can make it again in its place (use-undo.ts).
                const step = {
                  kind: "line" as const,
                  created: false,
                  accountId: account.id,
                  lineId: li.id,
                  body: { description: li.description, expression: li.expression },
                  order: lines.map((l) => l.id),
                };
                return api(
                  liUrl(li.id),
                  "DELETE",
                  undefined,
                  (b) => withoutLine(b, li.id),
                  () => record(step),
                );
              }, tAlloc("removeRow"))}
          </td>
        </tr>
      ))}

      {adjRows.map((row) => (
        <tr key={row.change.id} className="*:border-t bg-warning-soft/40">
          {gut(undefined)}
          {columns.map((col) => {
            if (col.key === "beskrivning")
              return (
                <td key={col.key} className="border-r border-border/60 px-2 py-1 text-sm">
                  <span className="flex items-center gap-1.5 pl-3">
                    <span className="shrink-0 font-medium text-warning">
                      {tChanges("label", {
                        kind: row.change.kind,
                        seq: row.change.seq,
                      })}
                    </span>
                    <span className="min-w-0 truncate text-muted" title={row.change.reason}>
                      {row.change.reason}
                    </span>
                    <span className="shrink-0 text-xs text-muted">
                      {date(row.change.createdAt)}
                    </span>
                  </span>
                </td>
              );
            if (col.key === "expression")
              return (
                <td key={col.key} className="px-2 py-1 text-right font-medium tabular-nums">
                  {fmtSigned(row.amount)}
                </td>
              );
            return <td key={col.key} className={rule(col)} />;
          })}
          {actualPad}
          <td />
        </tr>
      ))}

      {ghostLines.map((l) => (
        <tr key={`ghost-${l.key}`} className="*:border-t text-muted">
          {gut(undefined)}
          {columns.map((col) => (
            <td key={col.key} className={cn(rule(col), "px-2 py-1 text-sm")}>
              {col.key === "beskrivning" && <span className="pl-3">{l.description || "-"}</span>}
            </td>
          ))}
          <CompareCells other={l.values[1]} own={undefined} incomeLike={incomeLike} />
          <td />
        </tr>
      ))}

      {isAdmin && (
        // The blank row: an empty line like any other, which becomes one once something is
        // written in it and the row is left, and a fresh blank one takes its place. No row
        // number until then, so a row reference never points at it. Also where a dragged row
        // lands in an account with no rows of its own.
        <tr className="group bg-background *:border-t transition-colors hover:bg-hover">
          {gut(undefined)}
          {columns.map((col) => {
            const base =
              "w-full bg-transparent px-2 py-1 text-sm outline-none placeholder:text-faint";
            // Created on leaving the row, not the field, so Beskrivning and Belopp can both be
            // filled first. Enter creates at once and keeps the caret here, in the new blank row.
            const leave = (e: React.FocusEvent<HTMLInputElement>) => {
              const to = e.relatedTarget as Node | null;
              if (to && e.currentTarget.closest("tr")?.contains(to)) return;
              createLine(account.id);
            };
            const keys = (e: React.KeyboardEvent) => {
              if (e.key === "Enter") createLine(account.id);
              if (e.key === "Escape") setDraft(account.id, { description: "", expression: "" });
            };
            if (col.key === "beskrivning")
              return (
                <td key={col.key} className="border-r border-border/60 p-0">
                  <input
                    data-blank-cell
                    aria-label={t("newLine")}
                    // Faint, so the row still reads as an empty line, but says what it is for.
                    placeholder={t("newLine")}
                    value={d.description}
                    onChange={(e) => setDraft(account.id, { description: e.target.value })}
                    onKeyDown={keys}
                    onBlur={leave}
                    className={cn(base, "pl-5")}
                  />
                </td>
              );
            if (col.key === "expression")
              return (
                <td key={col.key} className="p-0">
                  <input
                    data-blank-cell
                    aria-label={tCol("expression")}
                    value={d.expression}
                    onChange={(e) => setDraft(account.id, { expression: e.target.value })}
                    onKeyDown={keys}
                    onBlur={leave}
                    className={cn(base, "text-right tabular-nums")}
                  />
                </td>
              );
            return <td key={col.key} className={rule(col)} />;
          })}
          {actualPad}
          <td />
        </tr>
      )}

      {open && (
        <tr className="bg-surface">
          {/* sheet-field: a form field, not a sheet cell: keeps the focus ring and draws no cell box. */}
          <td colSpan={totalCols} className="sheet-field px-4 py-3">
            <div className="space-y-2">
              {account.comments.length === 0 && (
                <p className="text-xs text-muted">{t("noComments")}</p>
              )}
              {account.comments.map((cm) => (
                <div key={cm.id} className="group flex items-start gap-2 text-sm">
                  <span className="shrink-0 font-medium">{cm.author.name}</span>
                  <span className="flex-1 text-muted">{cm.body}</span>
                  {(cm.author.id === userId || isAdmin) && (
                    <span className="shrink-0">
                      {del(
                        () =>
                          api(`/api/budget-comments/${cm.id}`, "DELETE", undefined, (b) =>
                            withoutComment(b, cm.id),
                          ),
                        t("removeComment"),
                      )}
                    </span>
                  )}
                </div>
              ))}
              {canComment && (
                <input
                  value={commentDraft[account.id] ?? ""}
                  onChange={(e) =>
                    setCommentDraft((m) => ({
                      ...m,
                      [account.id]: e.target.value,
                    }))
                  }
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
                  className="w-full rounded-control border border-border-control bg-background px-3 py-1.5 text-sm"
                />
              )}
            </div>
          </td>
        </tr>
      )}
    </tbody>
  );
}

export function GhostAccountBlock({ account }: { account: JoinedAccount }) {
  const { columns, gut, tRam } = useSheet();
  const incomeLike = account.kind === "INCOME";
  return (
    <tbody className="[&>tr:last-child>*]:border-b">
      <tr className="bg-background text-muted">
        {gut(undefined)}

        <td className="border-r border-border/60 px-2 py-1 text-center text-sm font-medium tabular-nums">
          {account.code}
        </td>
        <td
          className="border-r border-border/60 px-3 py-1 text-sm font-semibold"
          colSpan={columns.length - 1}
        >
          {account.name}
          <span className="ml-2 text-xs font-normal">- {tRam("notInThisBudget")}</span>
        </td>
        <CompareCells other={account.totals[1]} own={undefined} incomeLike={incomeLike} strong />
        <td />
      </tr>
    </tbody>
  );
}

export function AddAccountRow({ kind }: { kind: AccountKind }) {
  const { accountOptionsFor, accounts, actualPad, columns, createAccount, isAdmin, t, tBook } =
    useSheet();
  if (!isAdmin) return null;
  return (
    <tbody>
      <tr className="bg-background">
        <td className="w-9 border-r border-border/60" />
        <td className="p-0" colSpan={columns.length + 1}>
          <Combobox
            options={accountOptionsFor(kind)}
            value=""
            onChange={(v) => createAccount(kind, v)}
            placeholder={t(kind === "INCOME" ? "newIncomeAccount" : "newCostAccount")}
            searchPlaceholder={tBook("accountSearch")}
            emptyText={accounts.length ? t("noMoreAccounts") : t("emptyChart")}
            buttonClassName={cn("w-full bg-transparent px-2 py-1 text-sm text-muted", TEXT_HOVER)}
            aria-label={t("addAccount")}
          />
        </td>
        {actualPad}
      </tr>
    </tbody>
  );
}
