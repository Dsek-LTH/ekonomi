"use client";

// Which cost centres an utlägg is charged to, and how much to each. Same look as the voucher table
// (components/voucher-editor.tsx); each row is a card on a phone. With one row its amount is the utlägg's own
// and not asked.
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { cn, uid } from "@/lib/ui/utils";
import { parseSEK, sekToInput } from "@/lib/domain/money";
import { AmountInput } from "@/components/ui/amount-input";
import { CONTROL_CELL, CONTROL_SIZES } from "@/components/ui/field";
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

// The table's columns, from the container's 2xl up.
const COLS = "@2xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_9rem_2.25rem]";

export function AllocationEditor({ costCenters, grossAmount, value, onChange }: Props) {
  const t = useTranslations("allocation");
  // Only ever the row `add` just made.
  const [focusRowId, setFocusRowId] = useState<string | null>(null);
  const total = value.reduce((s, r) => s + parseSEK(r.amount), 0);
  // Zero means nothing to distribute yet.
  const balanced = grossAmount !== 0 && Math.abs(total - grossAmount) < 0.005;
  const left = grossAmount - total;
  const single = value.length <= 1;

  // One row is the whole utlägg: its amount is kept equal to the gross.
  const only = single ? value[0] : undefined;
  useEffect(() => {
    if (!only) return;
    if (Math.abs(parseSEK(only.amount) - grossAmount) < 0.005) return;
    onChange([{ ...only, amount: grossAmount ? sekToInput(grossAmount) : "" }]);
  }, [only, grossAmount, onChange]);

  function update(id: string, patch: Partial<AllocationRow>) {
    onChange(value.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function remove(id: string) {
    if (value.length <= 1) return;
    onChange(value.filter((r) => r.id !== id));
  }

  // A new row starts unpicked, so focus goes to the cost centre.
  function add() {
    const row = makeRow("");
    setFocusRowId(row.id);
    onChange([...value, row]);
  }

  const ccOptions = costCenters.map((c) => ({
    value: c.code,
    label: `${c.code} - ${c.name}`,
    short: c.code,
  }));

  const comment = cn(
    "min-w-0 w-full border border-border-control bg-background italic text-muted",
    CONTROL_SIZES.sm,
    "text-sm placeholder:text-muted focus:not-italic focus:text-foreground",
    CONTROL_CELL,
  );

  return (
    <div className="@container">
      <div className="space-y-2 @2xl:space-y-0 @2xl:overflow-hidden @2xl:rounded-control @2xl:border @2xl:border-border">
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
              onChange={(v) => update(row.id, { costCenterCode: v })}
              placeholder={t("pick")}
              searchPlaceholder={t("search")}
              aria-label={t("costCenter")}
              variant="cell"
            />
            <div className="grid grid-cols-[minmax(0,1fr)_9rem] gap-2 @2xl:contents">
              <input
                type="text"
                placeholder={t("commentPlaceholder")}
                value={row.comment}
                onChange={(e) => update(row.id, { comment: e.target.value })}
                className={comment}
              />
              {single ? (
                <span
                  aria-label={t("amountPlaceholder")}
                  className={cn(
                    "flex items-center justify-end rounded-control border border-border bg-surface px-2.5 text-sm tabular-nums text-muted",
                    CONTROL_SIZES.sm,
                    CONTROL_CELL,
                  )}
                >
                  {grossAmount ? formatSEK(grossAmount) : ""}
                </span>
              ) : (
                <AmountInput
                  size="sm"
                  value={row.amount}
                  onChange={(amount) => update(row.id, { amount })}
                  placeholder={t("amountPlaceholder")}
                  aria-label={t("amountPlaceholder")}
                  suffix={t("unit")}
                  className={CONTROL_CELL}
                  inputClassName="text-right"
                />
              )}
            </div>
            <span className="contents @2xl:flex @2xl:items-center @2xl:justify-center">
              {!single && (
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
              )}
            </span>
          </div>
        ))}

        <div
          className={cn(
            "flex flex-wrap items-center justify-between gap-2 pt-1",
            "@2xl:grid @2xl:items-center @2xl:gap-0 @2xl:border-t @2xl:border-border @2xl:bg-surface @2xl:pt-0",
            COLS,
          )}
        >
          <div className="@2xl:col-span-2 @2xl:flex @2xl:items-center @2xl:justify-between @2xl:gap-2 @2xl:px-2.5 @2xl:py-2">
            <Button
              variant="link"
              type="button"
              onClick={add}
              disabled={single ? costCenters.length < 2 : value.length >= costCenters.length}
              className="text-sm"
            >
              {single ? t("split") : t("add")}
            </Button>
            {!single && (
              <span className="hidden @2xl:inline">
                <BalanceChip balanced={balanced} left={left} gross={grossAmount} />
              </span>
            )}
          </div>
          {!single && (
            <span className="flex items-center gap-2 @2xl:block @2xl:px-2.5 @2xl:py-2 @2xl:text-right">
              <span className="@2xl:hidden">
                <BalanceChip balanced={balanced} left={left} gross={grossAmount} />
              </span>
              <span className="text-sm font-medium tabular-nums">{formatSEK(total)}</span>
            </span>
          )}
          <span className="hidden @2xl:block" />
        </div>
      </div>
    </div>
  );
}

/** Whether the rows meet the amount, in the shape of BalanceChip (voucher-editor.tsx). */
function BalanceChip({
  balanced,
  left,
  gross,
}: {
  balanced: boolean;
  left: number;
  gross: number;
}) {
  const t = useTranslations("allocation");
  const chip =
    "inline-flex items-center gap-1.5 rounded-control px-2.5 py-0.5 text-xs font-medium tabular-nums";
  // Nothing to meet yet: not red.
  if (gross === 0)
    return <span className={cn(chip, "bg-surface text-muted")}>{t("noAmount")}</span>;
  if (balanced)
    return <span className={cn(chip, "bg-success-soft text-success")}>{t("balancedChip")}</span>;
  return (
    <span className={cn(chip, "bg-danger-soft text-danger")}>
      {left > 0 ? t("left", { amount: formatSEK(left) }) : t("over", { amount: formatSEK(-left) })}
    </span>
  );
}
