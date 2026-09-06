"use client";

// The voucher table: the rows of a verifikation, edited.
//
// Written for booking an utlägg and now shared with booking a day's takings,
// because they are the same act: the same seven columns, the same account and
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
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { Amount } from "@/components/ui/amount";
import { Combobox } from "@/components/ui/combobox";
import { DragHandle } from "@/components/ui/drag";
import { IconButton } from "@/components/ui/icon-button";
import { Notice } from "@/components/ui/notice";
import { IconLock, IconX } from "@/components/ui/icons";
import { TableScroll } from "@/components/ui/table-scroll";
import { isAmountInput } from "@/lib/domain/money";
import { amountFieldProps } from "@/components/ui/amount-input";
import type { VoucherBlocker } from "@/lib/domain/voucher";
import type { AccountRecord, CostCenter } from "@/lib/domain/types";
import { cn, uid } from "@/lib/ui/utils";

export interface VoucherEditorRow {
  id: string;
  account: string;
  description: string;
  costCenterCode: string;
  /** Kronor as typed, so "1 234,50" or "", never a number. See isAmountInput. */
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
 * A row nobody has put anything in. The table always holds three of them (see
 * BLANK_ROWS), so they are not rows of the voucher. They are where the next one
 * is written. Every caller has to drop them before it counts, validates or posts
 * anything: `filledVoucherRows`.
 */
export const isBlankVoucherRow = (r: VoucherEditorRow) =>
  !r.account.trim() &&
  !r.description.trim() &&
  !r.costCenterCode.trim() &&
  !r.debit.trim() &&
  !r.credit.trim();

/** The rows that are actually a voucher: the typed ones, without the spare. */
export const filledVoucherRows = (rows: VoucherEditorRow[]) => rows.filter((r) => !isBlankVoucherRow(r));

// How many spare rows the table holds. Three is enough that the common voucher,
// a cost row with its VAT and a rounding, is written without ever asking for
// another, and the editor tops them back up as they are used, so there is no
// "add row" button to reach for at all.
const BLANK_ROWS = 3;

/**
 * The rows with exactly BLANK_ROWS empty ones among them, or null when they
 * already are that.
 *
 * Three empty rows, not three empty rows *at the bottom*: a spare row can be
 * dragged up between two filled ones and left there, to be written in next, and
 * counting only the trailing ones would answer that by adding a fourth.
 *
 * New ones go on the end, where the next line is usually written. Extra ones are
 * taken from the end too, so a row someone is standing in, the one they have
 * just emptied, is never the one that disappears from under them.
 */
function withBlankRows(rows: VoucherEditorRow[]): VoucherEditorRow[] | null {
  const blanks = rows.length - filledVoucherRows(rows).length;
  if (blanks === BLANK_ROWS) return null;
  if (blanks < BLANK_ROWS) {
    return [...rows, ...Array.from({ length: BLANK_ROWS - blanks }, () => makeVoucherRow())];
  }
  let extra = blanks - BLANK_ROWS;
  const kept: VoucherEditorRow[] = [];
  for (let i = rows.length - 1; i >= 0; i--) {
    if (extra > 0 && isBlankVoucherRow(rows[i])) {
      extra--;
      continue;
    }
    kept.unshift(rows[i]);
  }
  return kept;
}

/**
 * A row the bookkeeper may read but not touch: the payment side of an utlägg,
 * the clearing account of a day's takings. It is not part of `rows` at all, so
 * there is no state the UI could let anyone edit it through; the page assembles
 * it into the payload itself.
 */
export interface VoucherLockedRow {
  account: string;
  accountName: string;
  description: string;
  /** Kronor. Whichever side is zero is left empty. */
  debit: number;
  credit: number;
  /** Why it is locked, on hover. */
  hint: string;
  label: string;
}

/**
 * A row being carried.
 *
 * The row itself is lifted out and follows the pointer exactly, leaving an
 * empty slot behind it in the table; the rows it passes snap into that slot
 * one at a time, each as the pointer crosses the halfway mark. So the only
 * thing that moves smoothly is the thing the hand is moving, and the table
 * under it is always a voucher you could read, never a line drawn between
 * two rows promising what would happen if you let go.
 *
 * A pointer drag and not HTML5's, which reports what you are over and not
 * where you are, and so can only ever snap. It also brings touch with it.
 */
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
  /** Kronor, including the locked row. The page has already built the payload. */
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
  // "1931 – Företagskonto", and for accounts the name reappears in its own
  // column.
  //
  // A value with no option to match it renders as the placeholder. The picker
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
    accounts.map((a) => ({ value: a.number, label: `${a.number} – ${a.name}`, short: a.number })),
    rows.map((r) => r.account),
  );
  const ccOptions = withRowValues(
    costCenters.map((c) => ({ value: c.code, label: `${c.code} – ${c.name}`, short: c.code })),
    rows.map((r) => r.costCenterCode),
  );

  const headerCell = "px-2 py-2.5 text-center font-medium";
  const cellInput =
    "block h-10 w-full bg-transparent px-2 text-center text-sm placeholder:text-muted focus-inset";
  const amountInput = cn(cellInput, "tabular-nums");
  // Tight padding: these two columns are only as wide as a code needs, so the
  // chevron and padding would otherwise be most of the box.
  const cellCombo = "h-10 gap-1 bg-transparent px-1.5 focus-inset";

  // A row in the air, and where it has got to. Declared up here because the
  // spare rows below wait on it; what it is for is at `startDrag`.
  const drag = useRef<Drag | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [draggedBy, setDraggedBy] = useState(0);

  // Keep the table's BLANK_ROWS spare rows stocked. See `withBlankRows`.
  //
  // Held in the caller's rows rather than beside them, because everything else
  // here already works on that one array. A second, editor-local list of rows
  // would have to be merged into it on every keystroke, and reordering would
  // have to know which list a row came from.
  //
  // Never while a row is in the air. A drag works from its own copy of the list
  // (see `startDrag`) so rows added underneath it would be dropped again by
  // the next move, and the table would flicker between the two lengths for as
  // long as the pointer was down. Whatever the drag leaves behind is tidied the
  // moment it ends.
  const stocked = withBlankRows(rows);
  useEffect(() => {
    if (readOnly || draggingId || !stocked) return;
    onChange(stocked);
  }, [stocked, readOnly, draggingId, onChange]);

  function patch(id: string, change: Partial<VoucherEditorRow>) {
    onChange(rows.map((r) => (r.id === id ? { ...r, ...change } : r)));
  }

  // Kronor still unaccounted for, from the totals the page has already summed,
  // the locked row included, which is what makes this the amount that would
  // finish the voucher. Positive: the debit side is short by it.
  const outstanding = totalCredit - totalDebit;

  /**
   * Fill in the amount that would balance the voucher, on the side that is
   * short, when focus leaves a row that has an account and no amount of its own.
   *
   * The one entry anyone would have made by hand, and the one they would have
   * worked out by reading the two totals at the bottom of the table. A row with
   * an amount already in it is never touched, because the difference is then a
   * disagreement to look at rather than a blank to fill, and neither is a spare row,
   * which is why the account is the condition: it is what says someone means
   * this row to be part of the voucher.
   */
  function balanceOnLeave(r: VoucherEditorRow) {
    if (readOnly) return;
    if (!r.account.trim() || r.debit.trim() || r.credit.trim()) return;
    // Under half an öre there is nothing to write; the voucher already meets.
    if (Math.abs(outstanding) < 0.005) return;
    patch(r.id, outstanding > 0 ? { debit: outstanding.toFixed(2) } : { credit: (-outstanding).toFixed(2) });
  }

  function startDrag(e: React.PointerEvent, row: VoucherEditorRow) {
    if (readOnly || e.button !== 0) return;
    const tr = (e.target as HTMLElement).closest("tr");
    const index = rows.findIndex((r) => r.id === row.id);
    if (!tr || index === -1) return;
    // Or the pointer selects its way down the table as the row follows it.
    e.preventDefault();
    drag.current = {
      id: row.id,
      startY: e.clientY,
      startIndex: index,
      index,
      rows,
      height: tr.getBoundingClientRect().height,
      // Every row, spare ones included: they are rows of the table like any
      // other, and stopping a drag short of them makes the last stretch of the
      // table a wall for no reason anyone dragging can see.
      lastIndex: rows.length - 1,
      before: rows,
    };
    setDraggingId(row.id);
    setDraggedBy(0);
  }

  // Followed on the window rather than the grip: the pointer leaves it within a
  // few pixels, because the row it belongs to is moving out from under it, and a drag
  // has to keep going when it does. Ends wherever the button comes up, page or
  // not, which is also what makes a pointer lost to a scroll or an alert end it.
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
      // Rounded, so a row is passed when the pointer is halfway across it,
      // and read off the pointer rather than the rows, which are moving.
      const wanted = Math.min(Math.max(d.startIndex + Math.round(delta / d.height), 0), d.lastIndex);
      if (wanted !== d.index) {
        const next = d.rows.slice();
        next.splice(wanted, 0, ...next.splice(d.index, 1));
        d.rows = next;
        d.index = wanted;
        onChange(next);
      }
      // The row's own slot has moved down the table by every row that snapped
      // past it; the offset is what is left over, and keeps it under the hand.
      //
      // Held inside the table: past the first or the last slot there is nowhere
      // further to go, so the row stops there and the pointer carries on
      // without it, rather than sailing off across the page still attached.
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

  /**
   * The keyboard's way to reorder: Alt+↑/↓ on any field in the row. A drag is a
   * shortcut for whoever has a mouse in their hand (see components/ui/drag.tsx)
   * and it is the only way to do this, so it cannot be the only way.
   *
   * The same reach a drag has: anywhere in the table, spare rows included.
   */
  function nudgeRow(id: string, delta: number) {
    const from = rows.findIndex((r) => r.id === id);
    const to = from + delta;
    if (from === -1 || to < 0 || to >= rows.length) return;
    const next = rows.slice();
    next.splice(to, 0, ...next.splice(from, 1));
    onChange(next);
  }
  // Anything that isn't on its way to an amount is simply not taken. The field
  // keeps what it had, so a stray letter leaves no trace to delete.
  function patchAmount(id: string, field: "debit" | "credit", value: string) {
    if (!isAmountInput(value)) return;
    patch(id, { [field]: value });
  }

  // Off to the right edge on its own layer, so the ✕ and the lock stay centred
  // in their column: as a flex sibling the grip took width from them and pushed
  // them off centre, and it appears on hover, which would have made the whole
  // column twitch.
  const dragHandle = "absolute inset-y-0 right-2 flex items-center text-muted";

  // The dash is for a voucher being read, where an empty cell is a fact about
  // it. While one is being written it is noise: three spare rows would put a
  // column of dashes under every voucher, saying nothing the empty pickers
  // beside them don't already.
  const cell = (value: string, dash = true) => (
    <div className="truncate text-center text-sm text-muted" title={value || undefined}>
      {value || (dash ? "–" : "")}
    </div>
  );

  // What the rows point at that this app does not have. Usually pre-filled
  // rather than typed, because an income report routes to whatever account its
  // product prefix names and nothing has ever checked that the account is in the
  // chart, so the row looks ordinary and the button is simply dead. Naming them is
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
            <tr className="divide-x divide-border border-b border-border bg-surface text-xs text-muted">
              <th className={cn(headerCell, "w-[10%]")}>{t("colAccount")}</th>
              <th className={cn(headerCell, "w-[18%]")}>{t("colAccountName")}</th>
              <th className={cn(headerCell, "w-[18%]")}>{t("colCostCenter")}</th>
              <th className={cn(headerCell, "w-[15%]")}>{t("colDescription")}</th>
              <th className={cn(headerCell, "w-[15%]")}>{t("colDebit")}</th>
              <th className={cn(headerCell, "w-[15%]")}>{t("colCredit")}</th>
              {/* Wide enough for the ✕ and the grip side by side. The name
                  column gave up the difference, being the one with slack. */}
              <th className="w-[9%]" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {locked && (
              <tr className="divide-x divide-border bg-surface">
                <td className="px-2 py-3 text-center align-middle font-medium tabular-nums">
                  {locked.account}
                </td>
                <td className="px-2 align-middle">{cell(locked.accountName, false)}</td>
                <td className="px-2 text-center align-middle text-sm text-muted" />
                <td className="px-2 text-center align-middle text-sm text-muted">
                  {locked.description}
                </td>
                <td className="px-2 text-center align-middle text-sm tabular-nums">
                  {locked.debit ? locked.debit.toFixed(2).replace(".", ",") : ""}
                </td>
                <td className="px-2 text-center align-middle text-sm font-medium tabular-nums">
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
            )}
            {rows.map((r) => {
              const blank = isBlankVoucherRow(r);
              // Any row can be picked up and put anywhere, spare ones included:
              // where a row sits is the bookkeeper's, and a spare row is only a
              // row nothing has been written in yet. Removing one is what the
              // editor would undo on the spot, so that is the one thing a spare
              // row does not offer.
              const movable = !readOnly;
              const removable = !readOnly && !blank;
              return (
              <tr
                key={r.id}
                className={cn(
                  "group divide-x divide-border",
                  // Lifted: over the rows it passes, on the card's own
                  // background so they don't read through it, and outlined so
                  // it is a row in hand rather than one that happens to overlap.
                  //
                  // Outline and not a shadow or a ring: box-shadow is not
                  // painted on the rows of a border-collapse table, which this
                  // is, so a shadow here would simply never appear.
                  draggingId === r.id &&
                    "relative z-10 bg-background outline outline-1 outline-border",
                  // The rows being passed take no hovers or clicks while a row
                  // is over them, because the pointer is holding something.
                  draggingId && draggingId !== r.id && "pointer-events-none",
                )}
                style={
                  draggingId === r.id ? { transform: `translateY(${draggedBy}px)` } : undefined
                }
                onBlur={(e) => {
                  const to = e.relatedTarget as HTMLElement | null;
                  // Nowhere in particular: a click on dead space, or the whole
                  // window going away. Not a move to the next row, so not the
                  // moment to write anything into this one.
                  if (!to) return;
                  if (e.currentTarget.contains(to)) return;
                  // A picker's menu hangs off <body>, so opening one reads as
                  // leaving the row, while the row is still being filled in.
                  if (to.closest("[data-combobox-panel]")) return;
                  balanceOnLeave(r);
                }}
                onKeyDown={(e) => {
                  if (!e.altKey || readOnly) return;
                  if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
                  e.preventDefault();
                  nudgeRow(r.id, e.key === "ArrowDown" ? 1 : -1);
                }}
              >
                <td className={readOnly ? "px-2 py-3 text-center align-middle tabular-nums" : "p-0 align-middle"}>
                  {readOnly ? (
                    r.account || "–"
                  ) : (
                    <Combobox
                      options={accountOptions}
                      value={r.account}
                      onChange={(v) => patch(r.id, { account: v })}
                      // Empty, not absent: left off, the picker falls back to
                      // its own "Välj…" and the column is full of them again.
                      placeholder=""
                      searchPlaceholder={t("accountSearch")}
                      align="center"
                      buttonClassName={cellCombo}
                      aria-label={t("colAccount")}
                    />
                  )}
                </td>
                {/* Derived from the picked account, so read-only either way.
                    It's the name the trigger no longer shows. */}
                <td className="px-2 align-middle">{cell(accountName(r.account), readOnly)}</td>
                <td className={readOnly ? "px-2 text-center align-middle text-muted" : "p-0 align-middle"}>
                  {readOnly ? (
                    r.costCenterCode || "–"
                  ) : (
                    <Combobox
                      options={ccOptions}
                      value={r.costCenterCode}
                      onChange={(v) => patch(r.id, { costCenterCode: v })}
                      // Nothing rather than a dash: an unpicked cost centre is
                      // ordinary (plenty of rows never take one) and the
                      // chevron is already saying there is a choice here.
                      placeholder=""
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
                    r.description || "–"
                  ) : (
                    // size=1 kills the ~180px default intrinsic width an <input>
                    // would otherwise contribute to the column.
                    //
                    // Out of the tab order, with the row's ✕: a voucher is
                    // written account → kostnadsställe → belopp, over and over,
                    // and a text nobody fills in most of the time should not be
                    // two of every four stops on that path. Tab from the credit
                    // lands on the next row's account. Still reached by clicking
                    // into it.
                    <input
                      size={1}
                      tabIndex={-1}
                      value={r.description}
                      onChange={(e) => patch(r.id, { description: e.target.value })}
                      className={cellInput}
                    />
                  )}
                </td>
                <td className={readOnly ? "px-2 text-center align-middle tabular-nums" : "p-0 align-middle"}>
                  {readOnly ? (
                    r.debit || "–"
                  ) : (
                    <input
                      size={1}
                      {...amountFieldProps({
                        value: r.debit,
                        onChange: (v) => patchAmount(r.id, "debit", v),
                      })}
                      className={amountInput}
                      // A field with no placeholder still needs a name: it disappears the moment you
                      // type, and a screen reader reading this row would otherwise
                      // announce the field as nothing at all. The account names
                      // which row it is.
                      aria-label={`${tDetail("debit")} ${r.account || ""}`.trim()}
                    />
                  )}
                </td>
                <td className={readOnly ? "px-2 text-center align-middle tabular-nums" : "p-0 align-middle"}>
                  {readOnly ? (
                    r.credit || "–"
                  ) : (
                    <input
                      size={1}
                      {...amountFieldProps({
                        value: r.credit,
                        onChange: (v) => patchAmount(r.id, "credit", v),
                      })}
                      aria-label={`${tDetail("credit")} ${r.account || ""}`.trim()}
                      className={amountInput}
                    />
                  )}
                </td>
                {/* The row's two handles, past its last field: remove it, and
                    pick it up. */}
                <td className="relative text-center align-middle">
                  {removable && (
                    <IconButton
                      tone="danger"
                      size="sm"
                      // Out of the tab order with the description. See there.
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
          <tfoot>
            <tr className="border-t border-border font-medium">
              {/* No "add row": there are always three waiting below the last
                  one, and a fourth appears as each is used. */}
              <td colSpan={4} className="px-3 py-3" />
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

// One chip shape for both of the things said under a voucher, so the reading of
// them is the tone and nothing else.
const chip = "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium";

/**
 * The balance state, said the same way on every booking screen: a green chip
 * when debit meets credit, the difference in red when it does not.
 */
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

/**
 * Why the voucher cannot be written yet: the companion to the balance chip,
 * and the reason the button beside it is dead.
 *
 * Warning rather than danger: an unpicked account is not an error, it is a
 * voucher that isn't finished, and red is already spoken for by a difference
 * that genuinely doesn't add up.
 *
 * Renders nothing for `unbalanced`, which the balance chip is already saying
 * next to it, and better, with the amount. That rule lives here rather than in
 * each screen's JSX so the two booking pages cannot drift on it.
 */
export function VoucherBlockerChip({ blocker }: { blocker: VoucherBlocker | null }) {
  // The blockers carry their own sentences, shared with the routes that return
  // them as error codes. See lib/domain/voucher.ts.
  const t = useTranslations("errors.voucher");
  if (!blocker || blocker === "unbalanced") return null;
  return <span className={cn(chip, "bg-warning-soft text-warning")}>{t(blocker)}</span>;
}
