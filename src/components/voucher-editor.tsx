"use client";

// The voucher table: the rows of a verifikation, edited.
//
// Written for booking an utlägg and now shared with booking a day's takings,
// because they are the same act — the same seven columns, the same account and
// cost-centre pickers, the same "does it balance" at the bottom. What differs
// between the two is what sits *above* it (an utlägg has a voucher text with a
// locked prefix; a day of takings has a date and a committee it cannot change)
// and what the locked row is, so those stay with the pages and only the table
// lives here.
//
// The rows are the caller's state. This renders them and reports edits; it
// decides nothing, which is what lets the same table serve a page that derives
// its rows from an expense's allocations and one that derives them from a
// report's account distributions.
import { useTranslations } from "next-intl";

import { Amount } from "@/components/ui/amount";
import { Combobox } from "@/components/ui/combobox";
import { IconButton } from "@/components/ui/icon-button";
import { Notice } from "@/components/ui/notice";
import { IconLock, IconPlus, IconX } from "@/components/ui/icons";
import { TableScroll } from "@/components/ui/table-scroll";
import { isAmountInput } from "@/lib/domain/money";
import type { AccountRecord, CostCenter } from "@/lib/domain/types";
import { cn, uid } from "@/lib/ui/utils";

export interface VoucherEditorRow {
  id: string;
  account: string;
  description: string;
  costCenterCode: string;
  /** Kronor as typed — "1 234,50", or "" — never a number. See isAmountInput. */
  debit: string;
  credit: string;
}

export const makeVoucherRow = (patch: Partial<VoucherEditorRow> = {}): VoucherEditorRow => ({
  id: uid(),
  account: "",
  description: "",
  costCenterCode: "",
  debit: "",
  credit: "",
  ...patch,
});

/**
 * A row the bookkeeper may read but not touch — the payment side of an utlägg,
 * the clearing account of a day's takings. It is not part of `rows` at all, so
 * there is no state the UI could let anyone edit it through; the page assembles
 * it into the payload itself.
 */
export interface VoucherLockedRow {
  account: string;
  accountName: string;
  description: string;
  /** Kronor. Whichever side is zero is shown as a dash. */
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
  locked,
  totalDebit,
  totalCredit,
  readOnly = false,
}: {
  rows: VoucherEditorRow[];
  onChange: (rows: VoucherEditorRow[]) => void;
  accounts: AccountRecord[];
  costCenters: CostCenter[];
  locked?: VoucherLockedRow;
  /** Kronor, including the locked row — the page has already built the payload. */
  totalDebit: number;
  totalCredit: number;
  /** A booked voucher being looked at rather than written. */
  readOnly?: boolean;
}) {
  const t = useTranslations("book");
  const tAlloc = useTranslations("allocation");
  const tDetail = useTranslations("expenses.detail");

  const accountName = (number: string) =>
    accounts.find((a) => a.number === number.trim())?.name ?? "";

  // `short` collapses the trigger to the bare code once picked, which is what
  // lets these columns stay narrow; search still matches the full
  // "1931 · Företagskonto", and for accounts the name reappears in its own
  // column.
  //
  // A value with no option to match it renders as the placeholder — the picker
  // has nothing to show, so it shows nothing, and a pre-filled row reads as an
  // empty one. That happens for an account a report routed to that is not in
  // the chart, or a cost centre outside the list this page was given. Carrying
  // them as options of their own means the row says what it holds; whether it
  // may be booked is a separate question, and the page still answers it no.
  const withRowValues = (
    known: { value: string; label: string; short: string }[],
    values: string[],
  ) => {
    const seen = new Set(known.map((o) => o.value));
    const extra = [...new Set(values.map((v) => v.trim()).filter((v) => v && !seen.has(v)))];
    return [...known, ...extra.map((value) => ({ value, label: value, short: value }))];
  };

  const accountOptions = withRowValues(
    accounts.map((a) => ({ value: a.number, label: `${a.number} · ${a.name}`, short: a.number })),
    rows.map((r) => r.account),
  );
  const ccOptions = withRowValues(
    costCenters.map((c) => ({ value: c.code, label: `${c.code} · ${c.name}`, short: c.code })),
    rows.map((r) => r.costCenterCode),
  );

  const headerCell = "px-2 py-2.5 text-center font-medium";
  const cellInput =
    "block h-10 w-full bg-transparent px-2 text-center text-sm placeholder:text-muted/50 focus-inset";
  const amountInput = cn(cellInput, "tabular-nums");
  // Tight padding: these two columns are only as wide as a code needs, so the
  // chevron and padding would otherwise be most of the box.
  const cellCombo = "h-10 gap-1 bg-transparent px-1.5 focus-inset";

  function patch(id: string, change: Partial<VoucherEditorRow>) {
    onChange(rows.map((r) => (r.id === id ? { ...r, ...change } : r)));
  }
  // Anything that isn't on its way to an amount is simply not taken — the field
  // keeps what it had, so a stray letter leaves no trace to delete.
  function patchAmount(id: string, field: "debit" | "credit", value: string) {
    if (!isAmountInput(value)) return;
    patch(id, { [field]: value });
  }

  const cell = (value: string) => (
    <div className="truncate text-center text-sm text-muted" title={value || undefined}>
      {value || "—"}
    </div>
  );

  // What the rows point at that this app does not have. Usually pre-filled
  // rather than typed — an income report routes to whatever account its product
  // prefix names, and nothing has ever checked that the account is in the chart
  // — so the row looks ordinary and the button is simply dead. Naming them is
  // the difference between "this is broken" and "3011 is missing from the
  // chart, go and add it".
  const unknown = (values: string[], has: (v: string) => boolean) => [
    ...new Set(values.map((v) => v.trim()).filter((v) => v && !has(v))),
  ];
  const unknownAccounts = readOnly
    ? []
    : unknown(
        rows.map((r) => r.account),
        (v) => accounts.some((a) => a.number === v),
      );
  const unknownCostCenters = readOnly
    ? []
    : unknown(
        rows.map((r) => r.costCenterCode),
        (v) => costCenters.some((c) => c.code === v),
      );

  return (
    <>
      {/* Above the table, not below it: this is the reason the button at the
          bottom is dead, and it should be read before the reader gets there
          wondering why. */}
      {(unknownAccounts.length > 0 || unknownCostCenters.length > 0) && (
        <div className="px-inset py-4">
          <Notice>
            {unknownAccounts.length > 0 && (
              <p>{t("unknownAccounts", { list: unknownAccounts.join(", ") })}</p>
            )}
            {unknownCostCenters.length > 0 && (
              <p>{t("unknownCostCenters", { list: unknownCostCenters.join(", ") })}</p>
            )}
          </Notice>
        </div>
      )}

      {/* TableScroll, not a bare overflow-x-auto, for the overscroll
          containment: a sideways swipe on the widest column here used to chain
          to the browser's back gesture. */}
      <TableScroll minWidth="min-w-[600px]">
        {/* table-fixed: the header percentages decide the columns, so a cell's
            content can never push the table wider than its container. */}
        <table className="w-full table-fixed border-collapse text-sm">
          <thead>
            <tr className="divide-x divide-border border-b border-border bg-surface/40 text-xs text-muted">
              <th className={cn(headerCell, "w-[10%]")}>{t("colAccount")}</th>
              <th className={cn(headerCell, "w-[22%]")}>{t("colAccountName")}</th>
              <th className={cn(headerCell, "w-[18%]")}>{t("colCostCenter")}</th>
              <th className={cn(headerCell, "w-[15%]")}>{t("colDescription")}</th>
              <th className={cn(headerCell, "w-[15%]")}>{t("colDebit")}</th>
              <th className={cn(headerCell, "w-[15%]")}>{t("colCredit")}</th>
              <th className="w-[5%]" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {locked && (
              <tr className="divide-x divide-border bg-surface/40">
                <td className="px-2 py-3 text-center align-middle font-medium tabular-nums">
                  {locked.account || "—"}
                </td>
                <td className="px-2 align-middle">{cell(locked.accountName)}</td>
                <td className="px-2 text-center align-middle text-sm text-muted">—</td>
                <td className="px-2 text-center align-middle text-sm text-muted">
                  {locked.description}
                </td>
                <td className="px-2 text-center align-middle text-sm tabular-nums">
                  {locked.debit ? locked.debit.toFixed(2).replace(".", ",") : "—"}
                </td>
                <td className="px-2 text-center align-middle text-sm font-medium tabular-nums">
                  {locked.credit ? locked.credit.toFixed(2).replace(".", ",") : "—"}
                </td>
                <td className="text-center align-middle">
                  <span
                    className="flex items-center justify-center px-2 text-muted/40"
                    title={locked.hint}
                    aria-label={locked.label}
                  >
                    <IconLock className="size-4" />
                  </span>
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="divide-x divide-border">
                <td className={readOnly ? "px-2 py-3 text-center align-middle tabular-nums" : "p-0 align-middle"}>
                  {readOnly ? (
                    r.account || "—"
                  ) : (
                    <Combobox
                      options={accountOptions}
                      value={r.account}
                      onChange={(v) => patch(r.id, { account: v })}
                      placeholder={t("accountPlaceholder")}
                      searchPlaceholder={t("accountSearch")}
                      align="center"
                      buttonClassName={cellCombo}
                      aria-label={t("colAccount")}
                    />
                  )}
                </td>
                {/* Derived from the picked account, so read-only either way —
                    it's the name the trigger no longer shows. */}
                <td className="px-2 align-middle">{cell(accountName(r.account))}</td>
                <td className={readOnly ? "px-2 text-center align-middle text-muted" : "p-0 align-middle"}>
                  {readOnly ? (
                    r.costCenterCode || "—"
                  ) : (
                    <Combobox
                      options={ccOptions}
                      value={r.costCenterCode}
                      onChange={(v) => patch(r.id, { costCenterCode: v })}
                      placeholder="—"
                      searchPlaceholder={tAlloc("search")}
                      allowClear
                      align="center"
                      buttonClassName={cellCombo}
                      aria-label={t("colCostCenter")}
                    />
                  )}
                </td>
                <td className={readOnly ? "px-2 text-center align-middle text-muted" : "p-0 align-middle"}>
                  {readOnly ? (
                    r.description || "—"
                  ) : (
                    // size=1 kills the ~180px default intrinsic width an <input>
                    // would otherwise contribute to the column.
                    <input
                      size={1}
                      value={r.description}
                      onChange={(e) => patch(r.id, { description: e.target.value })}
                      placeholder={t("textPlaceholder")}
                      className={cellInput}
                    />
                  )}
                </td>
                <td className={readOnly ? "px-2 text-center align-middle tabular-nums" : "p-0 align-middle"}>
                  {readOnly ? (
                    r.debit || "—"
                  ) : (
                    <input
                      size={1}
                      inputMode="decimal"
                      value={r.debit}
                      onChange={(e) => patchAmount(r.id, "debit", e.target.value)}
                      className={amountInput}
                      placeholder="0,00"
                      // A placeholder is not a label: it disappears the moment you
                      // type, and a screen reader reading this row would otherwise
                      // announce the field as nothing at all. The account names
                      // which row it is.
                      aria-label={`${tDetail("debit")} ${r.account || ""}`.trim()}
                    />
                  )}
                </td>
                <td className={readOnly ? "px-2 text-center align-middle tabular-nums" : "p-0 align-middle"}>
                  {readOnly ? (
                    r.credit || "—"
                  ) : (
                    <input
                      size={1}
                      inputMode="decimal"
                      value={r.credit}
                      onChange={(e) => patchAmount(r.id, "credit", e.target.value)}
                      aria-label={`${tDetail("credit")} ${r.account || ""}`.trim()}
                      className={amountInput}
                      placeholder="0,00"
                    />
                  )}
                </td>
                <td className="text-center align-middle">
                  {!readOnly && (
                    <IconButton
                      tone="danger"
                      size="sm"
                      label={tAlloc("removeRow")}
                      onClick={() => onChange(rows.length > 1 ? rows.filter((x) => x.id !== r.id) : rows)}
                    >
                      <IconX className="size-4" />
                    </IconButton>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-border font-medium">
              <td colSpan={4} className="px-3 py-3">
                {!readOnly && (
                  <button
                    onClick={() => onChange([...rows, makeVoucherRow()])}
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline"
                  >
                    <IconPlus className="size-4" />
                    {t("addRow")}
                  </button>
                )}
              </td>
              <td className="px-2 py-3 text-center">
                <Amount value={totalDebit} size="md" />
              </td>
              <td className="px-2 py-3 text-center">
                <Amount value={totalCredit} size="md" />
              </td>
              <td />
            </tr>
          </tfoot>
          </table>
      </TableScroll>
    </>
  );
}

/**
 * The balance state, said the same way on every booking screen: a green chip
 * when debit meets credit, the difference in red when it does not.
 */
export function BalanceChip({ balanced, difference }: { balanced: boolean; difference: string }) {
  const t = useTranslations("book");
  return balanced ? (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-success-soft px-3 py-1 text-sm font-medium text-success">
      {t("balanced")}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-danger-soft px-3 py-1 text-sm font-medium text-danger">
      {t("difference", { amount: difference })}
    </span>
  );
}
