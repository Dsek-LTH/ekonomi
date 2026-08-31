"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { cn, uid } from "@/lib/ui/utils";
import { parseSEK } from "@/lib/domain/money";
import { SignedAmountInput } from "@/components/ui/amount-input";
import { Combobox } from "@/components/ui/combobox";
import { IconButton } from "@/components/ui/icon-button";
import { IconX } from "@/components/ui/icons";
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
  grossAmount: number; // SEK, used only for the balance indicator
  value: AllocationRow[];
  onChange: (rows: AllocationRow[]) => void;
}

export function AllocationEditor({ costCenters, grossAmount, value, onChange }: Props) {
  const t = useTranslations("allocation");
  // Only ever the row `add` just made. Rows restored from a draft, and the one
  // a new utlägg opens with, are not focused, nothing was clicked to get them.
  const [focusRowId, setFocusRowId] = useState<string | null>(null);
  const total = value.reduce((s, r) => s + parseSEK(r.amount), 0);
  // A return is budgeted the same way, only negative, so the rows have to add
  // up to the gross whichever sign it has. Zero means nothing to distribute yet.
  const balanced = grossAmount !== 0 && Math.abs(total - grossAmount) < 0.005;

  function update(id: string, patch: Partial<AllocationRow>) {
    onChange(value.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function remove(id: string) {
    if (value.length <= 1) return;
    onChange(value.filter((r) => r.id !== id));
  }

  // A new row starts unpicked, like the first one. The cost centre is always
  // chosen deliberately, never guessed at from what's left over. Which is why
  // the new row's cost centre is also where the focus goes: the button that
  // made the row sits below it, so without this you land past every field you
  // just asked for and have to shift-tab back up into them.
  function add() {
    const row = makeRow("");
    setFocusRowId(row.id);
    onChange([...value, row]);
  }

  const ccOptions = costCenters.map((c) => ({ value: c.code, label: `${c.code} – ${c.name}`, short: c.code }));
  // Only the width. The box, its border and its padding belong to the control
  // now that the field is split. A class carrying its own border here would
  // fight the one the sign turns red.
  //
  // Wider than the 7rem it was: the sign has a cell of its own in front of the
  // figure, and a five-digit amount was already close to the edge.
  const amt = "w-36 shrink-0";

  const comment = cn(
    // Full width while stacked; the line's leftover once it shares one.
    "min-w-0 @md:flex-1 rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm italic text-muted",
    // The remaining focus: rules are about the text, not the ring. A hint set
    // in grey italic becomes ordinary typing once you are in the field.
    "placeholder:text-muted/50 focus:not-italic focus:text-foreground",
  );

  return (
    // Container queries, not breakpoints: this editor's width is set by whatever
    // it sits in, and beside a receipt panel you can drag, that width changes
    // while the viewport doesn't move at all. `sm:` asked the wrong question and
    // kept five controls on one line in 300px, squeezing the comment to nothing.
    <div className="@container space-y-3">
      {value.map((row) => (
        // Three widths. Under 448px everything stacks; from there the cost
        // centre takes a line and the rest share the next; past 672px, about
        // what five controls need, it's one row.
        <div key={row.id} className="flex flex-col gap-2 @2xl:flex-row @2xl:items-center">
          <Combobox
            className="@2xl:flex-1"
            autoFocus={row.id === focusRowId}
            options={ccOptions}
            value={row.costCenterCode}
            onChange={(v) => update(row.id, { costCenterCode: v })}
            placeholder={t("pick")}
            searchPlaceholder={t("search")}
            aria-label={t("costCenter")}
          />
          <div className="flex min-w-0 flex-col gap-2 @md:flex-row @md:items-center @2xl:flex-1">
            <input
              type="text"
              placeholder={t("commentPlaceholder")}
              value={row.comment}
              onChange={(e) => update(row.id, { comment: e.target.value })}
              className={comment}
            />
            {/* Kept together: the amount, its unit and the row's two buttons
                are one thing, and wrapping the unit onto its own line would
                read as a stray "kr". The sign button sits after the unit rather
                than between it and the figure, where it read as "12,50 − kr". */}
            <div className="flex shrink-0 items-center gap-2">
              {/* Bare, not the boxed AmountInput: the row draws its own frame
                  around the amount, the unit and the remove button. The props
                  carry the keypad, the guard and the separator all the same. */}
              {/* No word here, and none on the total above either: the sign
                  is the whole of what there is to say, and the figure beside
                  it going red says it a second time. A row of the distribution
                  is one line of a sum, and its sign only says whether it adds
                  or subtracts. Five controls already share this row. */}
              <SignedAmountInput
                size="sm"
                value={row.amount}
                onChange={(amount) => update(row.id, { amount })}
                title={t("negateAmount")}
                placeholder={t("amountPlaceholder")}
                aria-label={t("amountPlaceholder")}
                className={amt}
                inputClassName="text-right"
              />
              <span className="text-xs text-muted">kr</span>
              <IconButton
                tone="danger"
                label={t("removeRow")}
                disabled={value.length <= 1}
                onClick={() => remove(row.id)}
              >
                <IconX className="size-4" />
              </IconButton>
            </div>
          </div>
        </div>
      ))}

      <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
        <button
          type="button"
          onClick={add}
          disabled={value.length >= costCenters.length}
          className="text-sm font-medium text-accent hover:underline disabled:opacity-40"
        >
          {t("add")}
        </button>
        {grossAmount !== 0 && (
          <p className={cn("text-xs tabular-nums", balanced ? "text-success" : "text-warning")}>
            {total.toFixed(2)} / {grossAmount.toFixed(2)} kr
          </p>
        )}
      </div>
    </div>
  );
}
