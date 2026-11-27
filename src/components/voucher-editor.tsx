"use client";

// The voucher table, shared by utlägg, daily takings and levfaktura booking. The rows are the
// caller's state. With `accountsOnly` only the account on each row is editable.
// On a phone it stays a spreadsheet, so every row is in view while one is edited. Below md it shows only what a row is
// (Konto, Kostnadsställe, Debet, Kredit) and fits the screen. Benämning, Projekt and Beskrivning are a tap away
// ("Visa alla kolumner"), and the table then scrolls sideways.
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { formatNumber } from "@/lib/ui/format";
import { Combobox } from "@/components/ui/combobox";
import { DragHandle } from "@/components/ui/drag";
import { IconButton } from "@/components/ui/icon-button";
import { Issues } from "@/components/ui/notice";
import { IconAlert, IconLock, IconX } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { TableScroll } from "@/components/ui/table-scroll";
import { withBlankRows } from "@/lib/ui/blank-rows";
import { isAmountInput, isSum, isSumInput, sekToInput, settleAmount } from "@/lib/domain/money";
import type { VoucherBlocker } from "@/lib/domain/voucher";
import { retagRowText } from "@/lib/domain/cost-center-tag";
import type { AccountRecord, CostCenter, ProjectRecord } from "@/lib/domain/types";
import { cn, uid } from "@/lib/ui/utils";
import { COLUMN_RULES, GRID_LINES, GRID_TABLE, LIFTED_ROW, ROW_RULES } from "@/lib/ui/grid-table";
import { belowMiddle, placeAmong, useRowDrag } from "@/lib/ui/use-row-drag";

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
  const amountHeader = "px-2 py-2.5 text-right font-medium whitespace-nowrap";
  const cellInput =
    "block h-9 w-full bg-transparent px-2 text-center md:h-8 text-sm placeholder:text-muted focus-inset";
  const amountInput =
    "block h-9 w-full bg-transparent px-2 text-right md:h-8 text-sm tabular-nums placeholder:text-muted focus-inset not-focus:aria-invalid:text-danger";
  const cellCombo = "h-9 gap-1 bg-transparent px-1.5 focus-inset md:h-8";

  // Every column on a phone too, scrolling sideways. Off, a phone shows the four that say what a row is.
  const [allColumns, setAllColumns] = useState(false);
  /** On a column a phone leaves out until asked for. */
  const extra = allColumns ? "" : "max-md:hidden";

  // Rows moved by hand (lib/ui/use-row-drag.ts, shared with the budget sheet). The order changes as the row passes
  // others, so the spare rows and the sums follow it. Escape puts back the order the drag found.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });
  const bodyRef = useRef<HTMLTableSectionElement>(null);
  const drag = useRowDrag<{ id: string; rows: VoucherEditorRow[]; before: VoucherEditorRow[] }>({
    begin: (id) => ({ id, rows, before: rows }),
    over: (d, under, pointer) => {
      const over = under?.closest<HTMLElement>("tr[data-voucher-row]");
      const overId = over?.dataset.voucherRow;
      if (!over || !overId || overId === d.id) return;
      const ids = placeAmong(
        d.rows.map((r) => r.id),
        d.id,
        overId,
        belowMiddle(over, pointer.y),
      );
      if (ids.join() === d.rows.map((r) => r.id).join()) return;
      const byId = new Map(d.rows.map((r) => [r.id, r]));
      d.rows = ids.map((id) => byId.get(id)!);
      onChangeRef.current(d.rows);
    },
    drop: () => {},
    cancel: (d) => onChangeRef.current(d.before),
    // Over the rows that move, never up over the locked ones or down into the sums.
    bounds: () => {
      const all = bodyRef.current?.querySelectorAll<HTMLElement>("tr[data-voucher-row]");
      if (!all || all.length === 0) return null;
      return {
        top: all[0].getBoundingClientRect().top,
        bottom: all[all.length - 1].getBoundingClientRect().bottom,
      };
    },
  });
  const draggingId = drag.draggingId;

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

  /**
   * A row's account changed: an empty cost centre takes the voucher's. A cost centre already on the row stays, also on
   * a balance account. A stock account carries its stock's cost centre, and whether the row's code was the voucher's
   * one depended on the order the rows were changed in.
   */
  function patchAccount(r: VoucherEditorRow, account: string) {
    const shared = sharedCostCenter(rows);
    let costCenterCode = r.costCenterCode;
    if (shared && !isBalanceAccount(account) && !costCenterCode) costCenterCode = shared;
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
      outstanding > 0 ? { debit: sekToInput(outstanding) } : { credit: sekToInput(-outstanding) },
    );
  }

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
        // A plain amount in full and a sum as its answer, both as an amount field writes them
        // (sekToInput), so the cell holds the same text when it is entered again.
        const shown = settleAmount(value) ?? value;
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
      className="flex h-9 items-center justify-center truncate px-2 text-sm md:h-8"
      title={value || undefined}
    >
      {value}
    </div>
  );
  const givenAmount = (value: string) => (
    <div
      className="flex h-9 items-center justify-end truncate px-2 text-sm md:h-8"
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
      {/* Over the table they are about: the cells themselves are marked too. */}
      <Issues
        className="px-inset pt-3"
        items={[
          ...(unknownAccounts.length > 0
            ? [
                {
                  key: "accounts",
                  tone: "danger" as const,
                  text: t("unknownAccounts", { list: unknownAccounts.join(", ") }),
                },
              ]
            : []),
          ...(unknownCostCenters.length > 0
            ? [
                {
                  key: "costCenters",
                  tone: "danger" as const,
                  text: t("unknownCostCenters", { list: unknownCostCenters.join(", ") }),
                },
              ]
            : []),
          ...(unknownProjects.length > 0
            ? [
                {
                  key: "projects",
                  tone: "danger" as const,
                  text: t("unknownProjects", { list: unknownProjects.join(", ") }),
                },
              ]
            : []),
        ]}
      />

      <div className="flex justify-end px-inset py-1.5 md:hidden">
        <Button variant="ghost" size="sm" onClick={() => setAllColumns((on) => !on)}>
          {allColumns ? t("fewerColumns") : t("allColumns")}
        </Button>
      </div>

      <div className={GRID_LINES}>
        {/* Full width wherever it fits. On a phone with every column, wide enough to read and scrolled sideways. */}
        <TableScroll
          minWidth={cn(
            showProjects ? "md:min-w-[720px]" : "md:min-w-[600px]",
            allColumns && (showProjects ? "min-w-[720px]" : "min-w-[600px]"),
          )}
        >
          {/* Separate borders, so a carried row takes its column rules along (lib/ui/grid-table.ts). */}
          <table className={cn("w-full table-fixed text-sm", GRID_TABLE)}>
            <thead>
              <tr className={cn("bg-surface text-xs text-muted *:border-b", COLUMN_RULES)}>
                <th className={cn(headerCell, "w-[10%]")}>{t("colAccount")}</th>
                <th className={cn(headerCell, extra, showProjects ? "w-[15%]" : "w-[18%]")}>
                  {t("colAccountName")}
                </th>
                <th className={cn(headerCell, showProjects ? "w-[13%]" : "w-[18%]")}>
                  {t("colCostCenter")}
                </th>
                {showProjects && (
                  <th className={cn(headerCell, extra, "w-[13%]")}>{t("colProject")}</th>
                )}
                <th className={cn(headerCell, extra, showProjects ? "w-[16%]" : "w-[15%]")}>
                  {t("colDescription")}
                </th>
                {/* Fixed widths: "10 000,00" fits on one line, and the row's two small controls need no more. */}
                <th className={cn(amountHeader, "w-28")}>{t("colDebit")}</th>
                <th className={cn(amountHeader, "w-28")}>{t("colCredit")}</th>
                <th className="w-16" />
              </tr>
            </thead>
            <tbody ref={bodyRef}>
              {(locked ? [locked].flat() : []).map((locked) => (
                <tr key={locked.account} className={cn("bg-surface", ROW_RULES, COLUMN_RULES)}>
                  <td className="px-2 py-1.5 text-center align-middle font-medium tabular-nums">
                    {locked.account}
                  </td>
                  <td className={cn("px-2 align-middle", extra)}>
                    {cell(locked.accountName, false)}
                  </td>
                  <td className="px-2 text-center align-middle text-sm text-muted" />
                  {showProjects && (
                    <td className={cn("px-2 text-center align-middle text-sm text-muted", extra)} />
                  )}
                  <td className={cn("px-2 align-middle", extra)}>
                    {cell(locked.description ?? "", false)}
                  </td>
                  <td className="px-2 text-right align-middle text-sm whitespace-nowrap tabular-nums">
                    {locked.debit ? sekToInput(locked.debit) : ""}
                  </td>
                  <td className="px-2 text-right align-middle text-sm font-medium whitespace-nowrap tabular-nums">
                    {locked.credit ? sekToInput(locked.credit) : ""}
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
                    ref={drag.rowRef(r.id)}
                    data-voucher-row={r.id}
                    className={cn(
                      "group",
                      ROW_RULES,
                      COLUMN_RULES,
                      draggingId === r.id && LIFTED_ROW,
                      draggingId && draggingId !== r.id && "pointer-events-none",
                    )}
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
                    <td className={cn("px-2 align-middle", extra)}>
                      {cell(accountName(r.account), readOnly)}
                    </td>
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
                              description: retagRowText(
                                r.description,
                                r.costCenterCode,
                                v,
                                isLocal,
                              ),
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
                        className={cn(
                          fixed && !accountsOnly
                            ? "px-2 text-center align-middle text-muted"
                            : "p-0 align-middle",
                          extra,
                        )}
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
                    <td
                      className={cn(
                        fixed && !accountsOnly ? "px-2 align-middle" : "p-0 align-middle",
                        extra,
                      )}
                    >
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
                          ? "px-2 text-right align-middle whitespace-nowrap tabular-nums"
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
                          ? "px-2 text-right align-middle whitespace-nowrap tabular-nums"
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
                          onPointerDown={(e) => !fixed && drag.start(e, r.id)}
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
              <tr className="font-medium *:border-t *:border-border">
                <SpanLabel full={showProjects ? 5 : 4} compact={!allColumns}>
                  {t("sum")}
                </SpanLabel>
                <td className="px-2 py-1.5 text-right whitespace-nowrap tabular-nums">
                  {figure(totalDebit)}
                </td>
                <td className="px-2 py-1.5 text-right whitespace-nowrap tabular-nums">
                  {figure(totalCredit)}
                </td>
                <td />
              </tr>
              <tr className="font-medium *:border-t *:border-border">
                <SpanLabel full={showProjects ? 5 : 4} compact={!allColumns}>
                  {t("differenceLabel")}
                </SpanLabel>
                <td />
                <td
                  className={cn(
                    "px-2 py-1.5 text-right whitespace-nowrap tabular-nums",
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
      </div>
    </>
  );
}

/**
 * A footer label spanning the columns before the amounts. Their number differs with the phone's compact layout (Konto
 * and Kostnadsställe only), so both cells are drawn and CSS shows the one that fits: a hidden cell takes no part in
 * the table, and picking the span in script would disagree with the server's render on a phone.
 */
function SpanLabel({
  full,
  compact,
  children,
}: {
  full: number;
  compact: boolean;
  children: React.ReactNode;
}) {
  const label = "px-3 py-1.5 text-right";
  if (!compact)
    return (
      <td colSpan={full} className={label}>
        {children}
      </td>
    );
  return (
    <>
      <td colSpan={full} className={cn(label, "max-md:hidden")}>
        {children}
      </td>
      <td colSpan={2} className={cn(label, "md:hidden")}>
        {children}
      </td>
    </>
  );
}

const chip = "inline-flex items-center gap-1.5 rounded-control px-3 py-1 text-sm font-medium";

/**
 * Green chip when debit meets credit. Nothing when they do not: the table's Differens row already says by how much,
 * in red. The empty span keeps its place, so the buttons beside it (justify-between) do not jump across.
 */
export function BalanceChip({ balanced }: { balanced: boolean }) {
  const t = useTranslations("book");
  return balanced ? (
    <span className={cn(chip, "bg-success-soft text-success")}>{t("balanced")}</span>
  ) : (
    <span aria-hidden />
  );
}

/** Why the voucher cannot be written yet. Renders nothing for `unbalanced`, which the balance chip says. */
export function VoucherBlockerChip({ blocker }: { blocker: VoucherBlocker | null }) {
  const t = useTranslations("errors.voucher");
  if (!blocker || blocker === "unbalanced") return null;
  return <WarningChip>{t(blocker)}</WarningChip>;
}

/**
 * Why the main button beside it cannot be pressed yet. A line of warning text with its mark, not a filled chip: a
 * warning is never a filled box (docs/layout.md, "Warnings"), and filled it read as a second button.
 */
export function WarningChip({ children }: { children: React.ReactNode }) {
  return (
    <span role="status" className="inline-flex items-center gap-1.5 text-sm text-warning">
      <IconAlert className="size-4 shrink-0" />
      {children}
    </span>
  );
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
