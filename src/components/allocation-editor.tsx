"use client";

// Which cost centres an utlägg is charged to, and how much to each.
//
// Two shapes, because there are two kinds of utlägg. Almost all of them go to
// one cost centre, and for those this is one question, which cost centre, and
// the amount is the utlägg's own: there is nothing to split and nothing to add
// up, so neither is asked. "Dela upp" opens the other shape, for the few that
// are shared.
//
// Shared, it is the voucher table's look (components/voucher-editor.tsx),
// because it is the same kind of thing: rows of a code and an amount that have
// to add up. A header, cells without boxes of their own, the total under the
// amounts and a chip saying whether it meets. On a phone a table of three
// columns does not fit, so there each row is a card instead, with the same
// total and chip under them.
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { cn, uid } from "@/lib/ui/utils";
import { parseSEK } from "@/lib/domain/money";
import { AmountInput } from "@/components/ui/amount-input";
import { CONTROL_SIZES } from "@/components/ui/field";
import { Combobox } from "@/components/ui/combobox";
import { IconX } from "@/components/ui/icons";
import { formatSEK } from "@/lib/ui/format";
import type { CostCenter } from "@/lib/domain/types";

export interface AllocationRow {
  id: string;
  costCenterCode: string;
  amount: string;
  comment: string;
}

export function makeRow(code: string, amount = "", comment = ""): AllocationRow {
  return { id: uid(), costCenterCode: code, amount, comment };
}

interface Props {
  costCenters: CostCenter[];
  /** SEK, a magnitude. What the rows have to add up to. */
  grossAmount: number;
  value: AllocationRow[];
  onChange: (rows: AllocationRow[]) => void;
}

// As the form's own amount field writes one, so a row filled in for you reads
// the same as one typed.
const asInput = (sek: number) => (Math.round(sek * 100) / 100).toFixed(2).replace(".", ",");

// The table's columns, from the container's 2xl up: cost centre, comment,
// amount, and the narrow one the cross sits in.
const COLS = "@2xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_9rem_2.25rem]";

// A cell of the table: no box of its own from 2xl, the grid lines are the
// boxes, the same as the voucher table's cells. Below it, an ordinary control.
const CELL = "@2xl:h-10 @2xl:rounded-none @2xl:border-0 @2xl:bg-transparent focus-inset";

export function AllocationEditor({ costCenters, grossAmount, value, onChange }: Props) {
  const t = useTranslations("allocation");
  // Only ever the row `add` just made. Rows restored from a draft, and the one
  // a new utlägg opens with, are not focused, nothing was clicked to get them.
  const [focusRowId, setFocusRowId] = useState<string | null>(null);
  const total = value.reduce((s, r) => s + parseSEK(r.amount), 0);
  // Zero means nothing to distribute yet.
  const balanced = grossAmount !== 0 && Math.abs(total - grossAmount) < 0.005;
  const left = grossAmount - total;
  const single = value.length <= 1;

  // One row is the whole utlägg. Its amount is not asked, so it is kept equal
  // to the gross here, whichever form this sits in: the ordinary one also does
  // this itself, the milersättning one does not.
  const only = single ? value[0] : undefined;
  useEffect(() => {
    if (!only) return;
    if (Math.abs(parseSEK(only.amount) - grossAmount) < 0.005) return;
    onChange([{ ...only, amount: grossAmount ? asInput(grossAmount) : "" }]);
  }, [only, grossAmount, onChange]);

  function update(id: string, patch: Partial<AllocationRow>) {
    onChange(value.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  // Picking a cost centre on a row with no amount yet gives it what is left,
  // the way the voucher table balances a row you leave without one. The
  // commonest split is "this much here and the rest there", and the rest is a
  // sum nobody should have to do.
  function pick(row: AllocationRow, code: string) {
    const rest = grossAmount - (total - parseSEK(row.amount));
    const fill = !row.amount.trim() && code && rest > 0.005;
    update(row.id, fill ? { costCenterCode: code, amount: asInput(rest) } : { costCenterCode: code });
  }

  function remove(id: string) {
    if (value.length <= 1) return;
    onChange(value.filter((r) => r.id !== id));
  }

  // A new row starts unpicked. The cost centre is always chosen deliberately,
  // so that is where the focus goes: the button that made the row sits below
  // it, and without this you land past every field you just asked for.
  function add() {
    const row = makeRow("");
    setFocusRowId(row.id);
    onChange([...value, row]);
  }

  const ccOptions = costCenters.map((c) => ({ value: c.code, label: `${c.code} – ${c.name}`, short: c.code }));

  const comment = (cell: boolean) =>
    cn(
      "min-w-0 w-full border border-border bg-background italic text-muted",
      CONTROL_SIZES.sm,
      "text-sm placeholder:text-muted focus:not-italic focus:text-foreground",
      cell && CELL,
    );

  // ── One cost centre: the question, and the way to more than one ──────────
  if (single && only) {
    return (
      <div className="@container space-y-2">
        <div className="grid gap-2 @2xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <Combobox
            size="sm"
            options={ccOptions}
            value={only.costCenterCode}
            onChange={(v) => update(only.id, { costCenterCode: v })}
            placeholder={t("pick")}
            searchPlaceholder={t("search")}
            aria-label={t("costCenter")}
          />
          <input
            type="text"
            placeholder={t("commentPlaceholder")}
            value={only.comment}
            onChange={(e) => update(only.id, { comment: e.target.value })}
            className={comment(false)}
          />
        </div>
        <button
          type="button"
          // Into two: the first row keeps the whole amount until somebody
          // changes it, and the new one is where the next cost centre goes.
          onClick={add}
          disabled={costCenters.length < 2}
          className="text-sm font-medium text-accent hover:underline disabled:opacity-40"
        >
          {t("split")}
        </button>
      </div>
    );
  }

  // ── Several: the voucher table's shape ───────────────────────────────────
  return (
    <div className="@container">
      <div className="space-y-2 @2xl:space-y-0 @2xl:overflow-hidden @2xl:rounded-control @2xl:border @2xl:border-border">
        {/* The header, from 2xl only. On a phone each card's fields say what
            they are through their placeholders. */}
        <div
          className={cn(
            "hidden divide-x divide-border border-b border-border bg-surface text-xs font-medium text-muted @2xl:grid",
            COLS,
          )}
        >
          <span className="px-2.5 py-2">{t("costCenter")}</span>
          <span className="px-2.5 py-2">{t("comment")}</span>
          <span className="px-2.5 py-2 text-right">{t("amountPlaceholder")}</span>
          <span />
        </div>

        {value.map((row) => (
          <div
            key={row.id}
            className={cn(
              "group relative grid gap-2 rounded-control border border-border bg-surface/50 p-2",
              "@2xl:gap-0 @2xl:divide-x @2xl:divide-border @2xl:rounded-none @2xl:border-0 @2xl:border-b @2xl:bg-transparent @2xl:p-0 @2xl:last:border-b-0",
              COLS,
            )}
          >
            <Combobox
              size="sm"
              autoFocus={row.id === focusRowId}
              options={ccOptions}
              value={row.costCenterCode}
              onChange={(v) => pick(row, v)}
              placeholder={t("pick")}
              searchPlaceholder={t("search")}
              aria-label={t("costCenter")}
              buttonClassName={cn(CONTROL_SIZES.sm, "border border-border bg-background", CELL)}
            />
            <div className="grid grid-cols-[minmax(0,1fr)_9rem] gap-2 @2xl:contents">
              <input
                type="text"
                placeholder={t("commentPlaceholder")}
                value={row.comment}
                onChange={(e) => update(row.id, { comment: e.target.value })}
                className={comment(true)}
              />
              {/* A magnitude, like every figure in this form: which way the
                  whole claim goes is the utlägg's own question, asked once at
                  the top, and a row is a part of it. */}
              <AmountInput
                size="sm"
                value={row.amount}
                onChange={(amount) => update(row.id, { amount })}
                placeholder={t("amountPlaceholder")}
                aria-label={t("amountPlaceholder")}
                suffix={t("unit")}
                className={CELL}
                inputClassName="text-right"
              />
            </div>
            {/* On a phone, the cross on the card's corner, as on the receipt
                thumbnails. In the table, its own narrow column at the end of
                the row, as in the voucher table, shown on the row in hand. */}
            <span className="contents @2xl:flex @2xl:items-center @2xl:justify-center">
              <button
                type="button"
                onClick={() => remove(row.id)}
                aria-label={t("removeRow")}
                title={t("removeRow")}
                className={cn(
                  "absolute -right-2 -top-2 flex size-5 items-center justify-center rounded-full border border-border bg-background text-muted shadow-sm",
                  "@2xl:static @2xl:size-7 @2xl:rounded-control @2xl:border-0 @2xl:bg-transparent @2xl:shadow-none",
                  "opacity-0 transition-opacity hover:text-danger focus:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100",
                )}
              >
                <IconX className="size-3 @2xl:size-4" />
              </button>
            </span>
          </div>
        ))}

        {/* The foot: add a row, whether it meets, and the total under the
            amounts, where the voucher table keeps its sums. */}
        <div
          className={cn(
            "flex flex-wrap items-center justify-between gap-2 pt-1",
            "@2xl:grid @2xl:items-center @2xl:gap-0 @2xl:border-t @2xl:border-border @2xl:bg-surface @2xl:pt-0",
            COLS,
          )}
        >
          <div className="@2xl:col-span-2 @2xl:flex @2xl:items-center @2xl:justify-between @2xl:gap-2 @2xl:px-2.5 @2xl:py-2">
            <button
              type="button"
              onClick={add}
              disabled={value.length >= costCenters.length}
              className="text-sm font-medium text-accent hover:underline disabled:opacity-40"
            >
              {t("add")}
            </button>
            <span className="hidden @2xl:inline">
              <BalanceChip balanced={balanced} left={left} />
            </span>
          </div>
          <span className="flex items-center gap-2 @2xl:block @2xl:px-2.5 @2xl:py-2 @2xl:text-right">
            <span className="@2xl:hidden">
              <BalanceChip balanced={balanced} left={left} />
            </span>
            <span className="text-sm font-medium tabular-nums">{formatSEK(total)}</span>
          </span>
          <span className="hidden @2xl:block" />
        </div>
      </div>
    </div>
  );
}

/**
 * Whether the rows meet the amount, in the voucher table's chip shape
 * (BalanceChip in voucher-editor.tsx): green when they do, the difference in
 * red when they don't, said as what is left or what is too much.
 */
function BalanceChip({ balanced, left }: { balanced: boolean; left: number }) {
  const t = useTranslations("allocation");
  const chip = "inline-flex items-center gap-1.5 rounded-control px-2.5 py-0.5 text-xs font-medium tabular-nums";
  if (balanced) return <span className={cn(chip, "bg-success-soft text-success")}>{t("balancedChip")}</span>;
  return (
    <span className={cn(chip, "bg-danger-soft text-danger")}>
      {left > 0 ? t("left", { amount: formatSEK(left) }) : t("over", { amount: formatSEK(-left) })}
    </span>
  );
}
