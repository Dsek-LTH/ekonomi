"use client";

// The voucher table, shared by utlägg, daily takings and levfaktura booking. The rows are the
// caller's state. With `accountsOnly` only the account on each row is editable.
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { formatNumber } from "@/lib/ui/format";
import { Combobox } from "@/components/ui/combobox";
import { DragHandle } from "@/components/ui/drag";
import { IconButton } from "@/components/ui/icon-button";
import { Notice } from "@/components/ui/notice";
import { IconLock, IconX } from "@/components/ui/icons";
import { TableScroll } from "@/components/ui/table-scroll";
import { withBlankRows } from "@/lib/ui/blank-rows";
import { isAmountInput, isSum, isSumInput, settleAmount } from "@/lib/domain/money";
import type { VoucherBlocker } from "@/lib/domain/voucher";
import { retagRowText } from "@/lib/domain/cost-center-tag";
import type { AccountRecord, CostCenter, ProjectRecord } from "@/lib/domain/types";
import { cn, uid } from "@/lib/ui/utils";

export interface VoucherEditorRow {
  id: string;
  account: string;
  description: string;
  costCenterCode: string;
  /** Fortnox project number. Only on pages that show the project column. */
  project?: string;
  /** Kronor as typed, so "1 234,50" or "", never a number. See isAmountInput. */
  debit: string;
  credit: string;
}

export const makeVoucherRow = (patch: Partial<VoucherEditorRow> = {}): VoucherEditorRow => ({
  id: uid(),
  account: "",
  description: "",
  costCenterCode: "",
  project: "",
  debit: "",
  credit: "",
  ...patch,
});

/** A row nobody has typed in. Callers must drop spares with `filledVoucherRows` before counting or posting. */
const isBlankVoucherRow = (r: VoucherEditorRow) =>
  !r.account.trim() &&
  !r.description.trim() &&
  !r.costCenterCode.trim() &&
  !(r.project ?? "").trim() &&
  !r.debit.trim() &&
  !r.credit.trim();

/** The rows that are actually a voucher: the typed ones, without the spare. */
export const filledVoucherRows = (rows: VoucherEditorRow[]) =>
  rows.filter((r) => !isBlankVoucherRow(r));

// Spare rows kept in the table, topped up by lib/ui/blank-rows.ts.
const BLANK_ROWS = 3;

/** A balance account (class 1 or 2) takes no voucher-wide cost centre, as in Fortnox. */
const isBalanceAccount = (account: string) => /^[12]/.test(account.trim());

/** A row the voucher-wide cost centre applies to: written in and not on a balance account. */
const takesSharedCostCenter = (r: VoucherEditorRow) =>
  !isBlankVoucherRow(r) && !isBalanceAccount(r.account);

/** The voucher-wide cost centre read off the rows: `null` when they disagree, `undefined` when no row applies. */
function sharedCostCenter(rows: VoucherEditorRow[]): string | null | undefined {
  const sharing = rows.filter(takesSharedCostCenter);
  if (sharing.length === 0) return undefined;
  const first = sharing[0].costCenterCode;
  return sharing.every((r) => r.costCenterCode === first) ? first : null;
}

/** A row shown but not editable (payment side of an utlägg, clearing account of takings). Not part of `rows`. */
export interface VoucherLockedRow {
  account: string;
  accountName: string;
  description?: string;
  /** Kronor. Whichever side is zero is left empty. */
  debit: number;
  credit: number;
  /** Why it is locked, on hover. */
  hint: string;
  label: string;
}

/** A row being carried by a pointer drag (not HTML5 drag, which cannot follow the pointer and lacks touch). */
interface Drag {
  id: string;
  /** Where the pointer went down, and where the row sat in the list then. */
  startY: number;
  startIndex: number;
  /** Where it sits now, and the rows in that order. The ref leads `rows`. */
  index: number;
  rows: VoucherEditorRow[];
  /** One row's height, in pixels, and the last slot in the table. */
  height: number;
  lastIndex: number;
  /** For Escape: the order the drag found. */
  before: VoucherEditorRow[];
}

export function VoucherEditor({
  rows,
  onChange,
  accounts,
  costCenters,
  projects,
  locked,
  totalDebit,
  totalCredit,
  readOnly = false,
  accountsOnly = false,
}: {
  rows: VoucherEditorRow[];
  onChange: (rows: VoucherEditorRow[]) => void;
  accounts: AccountRecord[];
  costCenters: CostCenter[];
  /** Given, the table has a project column picking from these. */
  projects?: ProjectRecord[];
  /** One, or several: a levfaktura's leverantörsskuld and its öresutjämning. */
  locked?: VoucherLockedRow | VoucherLockedRow[];
  /** Kronor, including the locked row. The page has already built the payload. */
  totalDebit: number;
  totalCredit: number;
  /** A booked voucher being looked at rather than written. */
  readOnly?: boolean;
  /** The rows are given and stay as given, and only their accounts are
   *  picked: no spare rows, no removing or moving one, no amount filled in. */
  accountsOnly?: boolean;
}) {
  const t = useTranslations("book");
  const tAlloc = useTranslations("allocation");
  const tVoucher = useTranslations("common.voucher");

  const accountName = (number: string) =>
    accounts.find((a) => a.number === number.trim())?.name ?? "";
  const fixed = readOnly || accountsOnly;

  // `short` collapses the trigger to the bare code once picked. A value with no matching option
  // would render as the placeholder, so such values are carried as options of their own.
  const withRowValues = (
    known: { value: string; label: string; short: string }[],
    values: string[],
  ) => {
    const seen = new Set(known.map((o) => o.value));
    const extra = [...new Set(values.map((v) => v.trim()).filter((v) => v && !seen.has(v)))];
    return [...known, ...extra.map((value) => ({ value, label: value, short: value }))];
  };

  const accountOptions = withRowValues(
    accounts.map((a) => ({
      value: a.number,
      label: `${a.number} - ${a.name}`,
      short: a.number,
    })),
    rows.map((r) => r.account),
  );
  const ccOptions = withRowValues(
    costCenters.map((c) => ({ value: c.code, label: `${c.code} - ${c.name}`, short: c.code })),
    rows.map((r) => r.costCenterCode),
  );
  const showProjects = projects !== undefined;
  const projectOptions = withRowValues(
    (projects ?? []).map((p) => ({
      value: p.number,
      label: `${p.number} - ${p.name}`,
      short: p.number,
    })),
    rows.map((r) => r.project ?? ""),
  );

  const headerCell = "px-2 py-2.5 text-center font-medium";
  const amountHeader = "px-2 py-2.5 text-right font-medium";
  const cellInput =
    "block h-8 w-full bg-transparent px-2 text-center text-sm placeholder:text-muted focus-inset";
  const amountInput =
    "block h-8 w-full bg-transparent px-2 text-right text-sm tabular-nums placeholder:text-muted focus-inset not-focus:aria-invalid:text-danger";
  const cellCombo = "h-8 gap-1 bg-transparent px-1.5 focus-inset";

  const drag = useRef<Drag | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [draggedBy, setDraggedBy] = useState(0);

  // Keep the BLANK_ROWS spare rows stocked (`withBlankRows`), but never during a drag: it works
  // from its own copy of the list.
  const stocked = withBlankRows(rows, BLANK_ROWS, isBlankVoucherRow, makeVoucherRow);
  useEffect(() => {
    if (fixed || draggingId || !stocked) return;
    onChange(stocked);
  }, [stocked, fixed, draggingId, onChange]);

  function patch(id: string, change: Partial<VoucherEditorRow>) {
    onChange(rows.map((r) => (r.id === id ? { ...r, ...change } : r)));
  }

  // A local cost centre is not sent to Fortnox, so its code goes into the row text (lib/domain/cost-center-tag).
  const isLocal = (code: string) =>
    costCenters.some((c) => c.code === code && c.source === "LOCAL");

  /** A row's account changed: the cost centre follows the voucher's, and a balance account gives it back. */
  function patchAccount(r: VoucherEditorRow, account: string) {
    const shared = sharedCostCenter(rows);
    let costCenterCode = r.costCenterCode;
    if (shared && !isBalanceAccount(account) && !costCenterCode) costCenterCode = shared;
    else if (shared && isBalanceAccount(account) && costCenterCode === shared) costCenterCode = "";
    patch(r.id, {
      account,
      costCenterCode,
      description: retagRowText(r.description, r.costCenterCode, costCenterCode, isLocal),
    });
  }

  // Kronor still unaccounted for, locked row included. Positive when debit is short.
  const outstanding = totalCredit - totalDebit;
  const figure = (kr: number) => formatNumber(kr, 2, 2);

  /** On leaving a row with an account and no amount, fill in the amount that balances the voucher. */
  function balanceOnLeave(r: VoucherEditorRow) {
    if (fixed) return;
    if (!r.account.trim() || r.debit.trim() || r.credit.trim()) return;
    if (Math.abs(outstanding) < 0.005) return;
    patch(
      r.id,
      outstanding > 0 ? { debit: outstanding.toFixed(2) } : { credit: (-outstanding).toFixed(2) },
    );
  }

  function startDrag(e: React.PointerEvent, row: VoucherEditorRow) {
    if (fixed || e.button !== 0) return;
    const tr = (e.target as HTMLElement).closest("tr");
    const index = rows.findIndex((r) => r.id === row.id);
    if (!tr || index === -1) return;
    // Stops text selection while dragging.
    e.preventDefault();
    drag.current = {
      id: row.id,
      startY: e.clientY,
      startIndex: index,
      index,
      rows,
      height: tr.getBoundingClientRect().height,
      lastIndex: rows.length - 1,
      before: rows,
    };
    setDraggingId(row.id);
    setDraggedBy(0);
  }

  // Tracked on the window: the grip moves out from under the pointer. Ends wherever the button comes up.
  useEffect(() => {
    if (!draggingId) return;
    const stop = () => {
      drag.current = null;
      setDraggingId(null);
      setDraggedBy(0);
    };
    const move = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const delta = e.clientY - d.startY;
      // Rounded: a row is passed when the pointer is halfway across it.
      const wanted = Math.min(
        Math.max(d.startIndex + Math.round(delta / d.height), 0),
        d.lastIndex,
      );
      if (wanted !== d.index) {
        const next = d.rows.slice();
        next.splice(wanted, 0, ...next.splice(d.index, 1));
        d.rows = next;
        d.index = wanted;
        onChange(next);
      }
      // Offset left after the snapped rows, clamped to the table.
      const offset = delta - (d.index - d.startIndex) * d.height;
      const top = -d.index * d.height;
      const bottom = (d.lastIndex - d.index) * d.height;
      setDraggedBy(Math.min(Math.max(offset, top), bottom));
    };
    const cancel = () => {
      if (drag.current) onChange(drag.current.before);
      stop();
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
  }, [draggingId, onChange]);

  /** Keyboard reorder: Alt+Arrow Up/Down on any field in the row, over the same range as a drag. */
  function nudgeRow(id: string, delta: number) {
    const from = rows.findIndex((r) => r.id === id);
    const to = from + delta;
    if (from === -1 || to < 0 || to >= rows.length) return;
    const next = rows.slice();
    next.splice(to, 0, ...next.splice(from, 1));
    onChange(next);
  }
  /** A debit or credit cell taking an amount or a sum (`1250*0,25+40`), worked out on blur. A bad sum stays as typed, in red. */
  function amountProps(r: VoucherEditorRow, field: "debit" | "credit") {
    const value = r[field];
    return {
      value,
      inputMode: "decimal" as const,
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
        const v = e.target.value;
        if (isAmountInput(v) || (isSum(v) && isSumInput(v))) patch(r.id, { [field]: v });
      },
      onBlur: () => {
        const settled = settleAmount(value);
        const shown = settled === null ? value : settled.replace(/\./g, ",");
        if (shown !== value) patch(r.id, { [field]: shown });
      },
      onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key !== "Enter" || !isSum(value)) return;
        e.preventDefault();
        const settled = settleAmount(value);
        if (settled !== null) patch(r.id, { [field]: settled });
      },
      "aria-invalid": isSum(value) && settleAmount(value) === null ? true : undefined,
    };
  }

  // Own layer at the right edge so the ✕ and the lock stay centred.
  const dragHandle = "absolute inset-y-0 right-2 flex items-center text-muted";

  // The dash is for a read voucher. While writing, empty cells stay empty.
  const cell = (value: string, dash = true) => (
    <div className="truncate text-center text-sm text-muted" title={value || undefined}>
      {value || (dash ? "-" : "")}
    </div>
  );
  const given = (value: string) => (
    <div
      className="flex h-8 items-center justify-center truncate px-2 text-sm"
      title={value || undefined}
    >
      {value}
    </div>
  );
  const givenAmount = (value: string) => (
    <div
      className="flex h-8 items-center justify-end truncate px-2 text-sm"
      title={value || undefined}
    >
      {value}
    </div>
  );

  // Accounts, cost centres and projects the rows point at that are missing (income reports route to unchecked accounts).
  const unknown = (values: string[], has: (v: string) => boolean) => [
    ...new Set(values.map((v) => v.trim()).filter((v) => v && !has(v))),
  ];
  const unknownAccounts = readOnly
    ? []
    : unknown(
        rows.map((r) => r.account),
        (v) => accounts.some((a) => a.number === v),
      );
  const unknownCostCenters = fixed
    ? []
    : unknown(
        rows.map((r) => r.costCenterCode),
        (v) => costCenters.some((c) => c.code === v),
      );
  const unknownProjects =
    fixed || !showProjects
      ? []
      : unknown(
          rows.map((r) => r.project ?? ""),
          (v) => (projects ?? []).some((p) => p.number === v),
        );
  return (
    <>
      {(unknownAccounts.length > 0 ||
        unknownCostCenters.length > 0 ||
        unknownProjects.length > 0) && (
        <div className="px-inset py-4">
          <Notice>
            {unknownAccounts.length > 0 && (
              <p>{t("unknownAccounts", { list: unknownAccounts.join(", ") })}</p>
            )}
            {unknownCostCenters.length > 0 && (
              <p>{t("unknownCostCenters", { list: unknownCostCenters.join(", ") })}</p>
            )}
            {unknownProjects.length > 0 && (
              <p>{t("unknownProjects", { list: unknownProjects.join(", ") })}</p>
            )}
          </Notice>
        </div>
      )}

      <TableScroll minWidth={showProjects ? "min-w-[720px]" : "min-w-[600px]"}>
        <table className="w-full table-fixed border-collapse text-sm">
          <thead>
            <tr className="divide-x divide-border border-b border-border bg-surface text-xs text-muted">
              <th className={cn(headerCell, "w-[10%]")}>{t("colAccount")}</th>
              <th className={cn(headerCell, showProjects ? "w-[15%]" : "w-[18%]")}>
                {t("colAccountName")}
              </th>
              <th className={cn(headerCell, showProjects ? "w-[13%]" : "w-[18%]")}>
                {t("colCostCenter")}
              </th>
              {showProjects && <th className={cn(headerCell, "w-[13%]")}>{t("colProject")}</th>}
              <th className={cn(headerCell, showProjects ? "w-[16%]" : "w-[15%]")}>
                {t("colDescription")}
              </th>
              <th className={cn(amountHeader, showProjects ? "w-[12%]" : "w-[15%]")}>
                {t("colDebit")}
              </th>
              <th className={cn(amountHeader, showProjects ? "w-[12%]" : "w-[15%]")}>
                {t("colCredit")}
              </th>
              <th className="w-[9%]" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {(locked ? [locked].flat() : []).map((locked) => (
              <tr key={locked.account} className="divide-x divide-border bg-surface">
                <td className="px-2 py-1.5 text-center align-middle font-medium tabular-nums">
                  {locked.account}
                </td>
                <td className="px-2 align-middle">{cell(locked.accountName, false)}</td>
                <td className="px-2 text-center align-middle text-sm text-muted" />
                {showProjects && (
                  <td className="px-2 text-center align-middle text-sm text-muted" />
                )}
                <td className="px-2 align-middle">{cell(locked.description ?? "", false)}</td>
                <td className="px-2 text-right align-middle text-sm tabular-nums">
                  {locked.debit ? locked.debit.toFixed(2).replace(".", ",") : ""}
                </td>
                <td className="px-2 text-right align-middle text-sm font-medium tabular-nums">
                  {locked.credit ? locked.credit.toFixed(2).replace(".", ",") : ""}
                </td>
                <td className="text-center align-middle">
                  <span
                    className="flex items-center justify-center px-2 text-muted"
                    title={locked.hint}
                    aria-label={locked.label}
                  >
                    <IconLock className="size-4" />
                  </span>
                </td>
              </tr>
            ))}
            {rows.map((r) => {
              const blank = isBlankVoucherRow(r);
              const movable = !fixed;
              const removable = !fixed && !blank;
              return (
                <tr
                  key={r.id}
                  className={cn(
                    "group divide-x divide-border",
                    // Outline, not shadow: box-shadow is not painted on rows of a border-collapse table.
                    draggingId === r.id &&
                      "relative z-10 bg-background outline outline-1 outline-border",
                    draggingId && draggingId !== r.id && "pointer-events-none",
                  )}
                  style={
                    draggingId === r.id ? { transform: `translateY(${draggedBy}px)` } : undefined
                  }
                  onBlur={(e) => {
                    const to = e.relatedTarget as HTMLElement | null;
                    // Dead space or window blur: not a move to another row.
                    if (!to) return;
                    if (e.currentTarget.contains(to)) return;
                    // A picker's menu hangs off <body>, so opening one is not leaving the row.
                    if (to.closest("[data-combobox-panel]")) return;
                    balanceOnLeave(r);
                  }}
                  onKeyDown={(e) => {
                    if (!e.altKey || fixed) return;
                    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
                    e.preventDefault();
                    nudgeRow(r.id, e.key === "ArrowDown" ? 1 : -1);
                  }}
                >
                  <td
                    className={
                      readOnly
                        ? "px-2 py-1.5 text-center align-middle tabular-nums"
                        : "p-0 align-middle"
                    }
                  >
                    {readOnly ? (
                      r.account || "-"
                    ) : (
                      <Combobox
                        options={accountOptions}
                        value={r.account}
                        onChange={(v) => patchAccount(r, v)}
                        // Empty, not absent: left off, the picker shows its own placeholder.
                        placeholder=""
                        searchPlaceholder={t("accountSearch")}
                        align="center"
                        buttonClassName={cellCombo}
                        aria-label={t("colAccount")}
                      />
                    )}
                  </td>
                  <td className="px-2 align-middle">{cell(accountName(r.account), readOnly)}</td>
                  <td
                    className={
                      fixed && !accountsOnly
                        ? "px-2 text-center align-middle text-muted"
                        : "p-0 align-middle"
                    }
                  >
                    {accountsOnly ? (
                      given(r.costCenterCode)
                    ) : fixed ? (
                      r.costCenterCode || "-"
                    ) : (
                      <Combobox
                        options={ccOptions}
                        value={r.costCenterCode}
                        onChange={(v) =>
                          patch(r.id, {
                            costCenterCode: v,
                            description: retagRowText(r.description, r.costCenterCode, v, isLocal),
                          })
                        }
                        placeholder=""
                        searchPlaceholder={tAlloc("search")}
                        allowClear
                        align="center"
                        buttonClassName={cellCombo}
                        aria-label={t("colCostCenter")}
                      />
                    )}
                  </td>
                  {showProjects && (
                    <td
                      className={
                        fixed && !accountsOnly
                          ? "px-2 text-center align-middle text-muted"
                          : "p-0 align-middle"
                      }
                    >
                      {accountsOnly ? (
                        given(r.project ?? "")
                      ) : fixed ? (
                        r.project || "-"
                      ) : (
                        <Combobox
                          options={projectOptions}
                          value={r.project ?? ""}
                          onChange={(v) => patch(r.id, { project: v })}
                          placeholder=""
                          searchPlaceholder={t("projectSearch")}
                          allowClear
                          align="center"
                          buttonClassName={cellCombo}
                          aria-label={t("colProject")}
                        />
                      )}
                    </td>
                  )}
                  <td className={fixed && !accountsOnly ? "px-2 align-middle" : "p-0 align-middle"}>
                    {accountsOnly ? (
                      given(r.description)
                    ) : fixed ? (
                      cell(r.description)
                    ) : (
                      // size=1 drops the default input width. Out of the tab order so Tab goes account, cost centre, amount.
                      <input
                        size={1}
                        tabIndex={-1}
                        value={r.description}
                        onChange={(e) => patch(r.id, { description: e.target.value })}
                        className={cellInput}
                      />
                    )}
                  </td>
                  <td
                    className={
                      fixed && !accountsOnly
                        ? "px-2 text-right align-middle tabular-nums"
                        : "p-0 align-middle"
                    }
                  >
                    {accountsOnly ? (
                      <div className="tabular-nums">{givenAmount(r.debit)}</div>
                    ) : fixed ? (
                      r.debit || "-"
                    ) : (
                      <input
                        size={1}
                        {...amountProps(r, "debit")}
                        className={amountInput}
                        aria-label={`${tVoucher("debit")} ${r.account || ""}`.trim()}
                      />
                    )}
                  </td>
                  <td
                    className={
                      fixed && !accountsOnly
                        ? "px-2 text-right align-middle tabular-nums"
                        : "p-0 align-middle"
                    }
                  >
                    {accountsOnly ? (
                      <div className="tabular-nums">{givenAmount(r.credit)}</div>
                    ) : fixed ? (
                      r.credit || "-"
                    ) : (
                      <input
                        size={1}
                        {...amountProps(r, "credit")}
                        aria-label={`${tVoucher("credit")} ${r.account || ""}`.trim()}
                        className={amountInput}
                      />
                    )}
                  </td>
                  <td className="relative text-center align-middle">
                    {removable && (
                      <IconButton
                        tone="danger"
                        size="sm"
                        tabIndex={-1}
                        label={tAlloc("removeRow")}
                        onClick={() => onChange(rows.filter((x) => x.id !== r.id))}
                      >
                        <IconX className="size-4" />
                      </IconButton>
                    )}
                    {movable && (
                      <DragHandle
                        onPointerDown={(e) => startDrag(e, r)}
                        title={t("dragRow")}
                        className={cn(dragHandle, draggingId === r.id && "opacity-100")}
                      />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="text-sm">
            <tr className="border-t border-border font-medium">
              <td colSpan={showProjects ? 5 : 4} className="px-3 py-1.5 text-right">
                {t("sum")}
              </td>
              <td className="px-2 py-1.5 text-right tabular-nums">{figure(totalDebit)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{figure(totalCredit)}</td>
              <td />
            </tr>
            <tr className="border-t border-border font-medium">
              <td colSpan={showProjects ? 5 : 4} className="px-3 py-1.5 text-right">
                {t("differenceLabel")}
              </td>
              <td />
              <td
                className={cn(
                  "px-2 py-1.5 text-right tabular-nums",
                  Math.abs(outstanding) >= 0.005 && "text-danger",
                )}
              >
                {figure(Math.abs(outstanding) < 0.005 ? 0 : Math.abs(outstanding))}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </TableScroll>
    </>
  );
}

const chip = "inline-flex items-center gap-1.5 rounded-control px-3 py-1 text-sm font-medium";

/** Green chip when debit meets credit, the difference in red when not. */
export function BalanceChip({ balanced, difference }: { balanced: boolean; difference: string }) {
  const t = useTranslations("book");
  return balanced ? (
    <span className={cn(chip, "bg-success-soft text-success")}>{t("balanced")}</span>
  ) : (
    <span className={cn(chip, "bg-danger-soft text-danger")}>
      {t("difference", { amount: difference })}
    </span>
  );
}

/** Why the voucher cannot be written yet. Renders nothing for `unbalanced`, which the balance chip says. */
export function VoucherBlockerChip({ blocker }: { blocker: VoucherBlocker | null }) {
  const t = useTranslations("errors.voucher");
  if (!blocker || blocker === "unbalanced") return null;
  return <WarningChip>{t(blocker)}</WarningChip>;
}

/** The blocker chip's shape, for a booking screen whose reasons are its own. */
export function WarningChip({ children }: { children: React.ReactNode }) {
  return <span className={cn(chip, "bg-warning-soft text-warning")}>{children}</span>;
}

/** The voucher-wide cost centre: one pick sets every row except spare and balance-account rows. A row's own cell overrides it. */
export function VoucherCostCenterPicker({
  rows,
  onChange,
  costCenters,
}: {
  rows: VoucherEditorRow[];
  onChange: (rows: VoucherEditorRow[]) => void;
  costCenters: CostCenter[];
}) {
  const t = useTranslations("book");
  const tAlloc = useTranslations("allocation");
  // Only for a voucher with no rows to read it off yet.
  const [picked, setPicked] = useState("");
  const shared = sharedCostCenter(rows);
  const isLocal = (code: string) =>
    costCenters.some((c) => c.code === code && c.source === "LOCAL");

  function pick(code: string) {
    setPicked(code);
    onChange(
      rows.map((r) =>
        !takesSharedCostCenter(r) || r.costCenterCode === code
          ? r
          : {
              ...r,
              costCenterCode: code,
              description: retagRowText(r.description, r.costCenterCode, code, isLocal),
            },
      ),
    );
  }

  return (
    <Combobox
      size="sm"
      options={costCenters.map((c) => ({
        value: c.code,
        label: `${c.code} - ${c.name}`,
      }))}
      value={shared === undefined ? picked : (shared ?? "")}
      onChange={pick}
      placeholder={shared === null ? t("allCostCenterMixed") : ""}
      searchPlaceholder={tAlloc("search")}
      allowClear
      aria-label={t("allCostCenter")}
    />
  );
}
