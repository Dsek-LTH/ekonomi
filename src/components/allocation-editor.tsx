"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { cn, uid } from "@/lib/ui/utils";
import { parseSEK } from "@/lib/domain/money";
import { AmountInput } from "@/components/ui/amount-input";
import { CONTROL_SIZES } from "@/components/ui/field";
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

  // On a box around the field rather than on the field. Every control in the
  // app is `w-full` inside whatever holds it (see CONTROL), so a width handed
  // to the control itself is a second width rule against the first, and which
  // of them wins is down to the order two utilities happen to be printed in.
  // The box decides how wide, the control fills it: that has one answer.
  // 8rem: nine digits at this size, a space between the thousands, a comma and
  // the "kr" now standing inside the box.
  const amt = "w-32 shrink-0";

  const comment = cn(
    // Whatever the figure and the button leave of the line.
    "min-w-0 flex-1 border border-border bg-background italic text-muted",
    // The same height as the combobox and the amount it shares a line with.
    // It used to carry its own padding, which stood it 34px against their 36,
    // and a row of three controls at two heights reads as a mistake.
    CONTROL_SIZES.sm,
    "text-sm",
    // The remaining focus: rules are about the text, not the ring. A hint set
    // in grey italic becomes ordinary typing once you are in the field.
    "placeholder:text-muted focus:not-italic focus:text-foreground",
  );

  return (
    // Container queries, not breakpoints: this editor's width is set by whatever
    // it sits in, and beside a receipt panel you can drag, that width changes
    // while the viewport doesn't move at all. `sm:` asked the wrong question and
    // kept five controls on one line in 300px, squeezing the comment to nothing.
    <div className="@container space-y-3">
      {value.map((row) => (
        // Two widths, not three. The comment, the figure and the remove button
        // share a line at every size: they are the row's own line, the figure
        // is a fixed 8rem of it and the comment takes what is left, which is
        // still a usable field on a 320px phone. Only the cost centre gets a
        // line of its own until 672px, about what the four controls need.
        <div key={row.id} className="flex flex-col gap-2 @2xl:flex-row @2xl:items-center">
          <Combobox
            // The compact register, like the two fields it shares the row
            // with. Without this it takes the form size and stands 42px beside
            // their 36, which is what made the row look assembled rather than
            // designed.
            size="sm"
            className="@2xl:flex-1"
            autoFocus={row.id === focusRowId}
            options={ccOptions}
            value={row.costCenterCode}
            onChange={(v) => update(row.id, { costCenterCode: v })}
            placeholder={t("pick")}
            searchPlaceholder={t("search")}
            aria-label={t("costCenter")}
          />
          <div className="flex min-w-0 items-center gap-2 @2xl:flex-1">
            <input
              type="text"
              placeholder={t("commentPlaceholder")}
              value={row.comment}
              onChange={(e) => update(row.id, { comment: e.target.value })}
              className={comment}
            />
            {/* A magnitude, like every figure in this form: which way the whole
                claim goes is the utlägg's own question, asked once at the top
                of the step, and a row is a part of it. The unit rides inside
                the box, the way the strength field on a stock product carries
                its "%": outside it was a third thing on the line and the one
                most easily read as a word in the comment. */}
            <div className={amt}>
              <AmountInput
                size="sm"
                value={row.amount}
                onChange={(amount) => update(row.id, { amount })}
                placeholder={t("amountPlaceholder")}
                aria-label={t("amountPlaceholder")}
                suffix={t("unit")}
                inputClassName="text-right"
              />
            </div>
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
