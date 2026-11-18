"use client";

// The parameter panel of a page that reads figures over a period: Utfall & rapporter, lagerstatistik. Rows of labelled
// decisions, one decision per row, hairline between. Beside the figures from lg (a narrow column, fields stacked), above
// them on a phone. The period row is shared so the two pages pick a period the same way (lib/ui/period.ts).
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Combobox } from "@/components/ui/combobox";
import { DateInput } from "@/components/ui/field";
import { cn } from "@/lib/ui/utils";

/** One decision, labelled. A <span>, not a <label>: every control in a panel carries its own aria-label. */
export function PanelField({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <span className="text-xs font-medium text-muted">{label}</span>
      {children}
    </div>
  );
}

/** Pills are shorter than a Combobox trigger (h-8, components/ui/field.tsx), so every control in the panel is field-height. */
export const PANEL_PILLS = "[&>button]:h-10 sm:[&>button]:h-8";

/** One row of the panel, hairline above except the first. From lg the panel is a narrow column, so fields stack. */
export function PanelRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end gap-x-6 gap-y-3 border-t border-border px-inset py-3.5 first:border-t-0 lg:flex-col lg:flex-nowrap lg:items-stretch lg:[&>*]:w-full">
      {children}
    </div>
  );
}

/** The period picker's state, from periodOptions (lib/ui/period.ts). */
export interface PeriodChoice {
  options: { value: string; label: string }[];
  value: string;
  onPick: (value: string) => void;
  /** A date was typed or picked by hand: the range is the reader's own now. */
  onManual: () => void;
}

/**
 * One end of the period, as a date typed or picked. Typed text is only handed on once it is a whole, existing date,
 * since every change refetches. Half-typed reverts to the date shown. A server that clamps the period reports back
 * what it used, arriving as a new `value`.
 */
export function PeriodDate({
  value,
  onCommit,
  "aria-label": ariaLabel,
}: {
  value: string | null;
  onCommit: (date: string) => void;
  "aria-label": string;
}) {
  const [draft, setDraft] = useState(value ?? "");
  // When the page answers with a different date (clamped, or a new year), the field follows; adjusted during render to avoid a stale frame.
  const [shown, setShown] = useState(value);
  if (value !== shown) {
    setShown(value);
    setDraft(value ?? "");
  }
  const isDate = (s: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(`${s}T00:00:00Z`).getTime());

  return (
    <DateInput
      size="sm"
      value={draft}
      aria-label={ariaLabel}
      onChange={(e) => {
        const next = e.target.value;
        setDraft(next);
        if (isDate(next) && next !== value) onCommit(next);
      }}
      onBlur={() => {
        if (!isDate(draft)) setDraft(value ?? "");
      }}
    />
  );
}

/** The period: a named one from the picker (when there is a year to name them in), and the dates it covers. */
export function PeriodRow({
  from,
  to,
  onRange,
  period,
}: {
  from: string | null;
  to: string | null;
  /** A date typed by hand, one end at a time. */
  onRange: (patch: { from?: string; to?: string }) => void;
  period?: PeriodChoice;
}) {
  const t = useTranslations("common.period");
  return (
    <PanelRow>
      {period && (
        <PanelField label={t("label")} className="w-full sm:w-56">
          <Combobox
            size="sm"
            options={period.options}
            value={period.value}
            onChange={period.onPick}
            searchPlaceholder={t("search")}
            aria-label={t("label")}
          />
        </PanelField>
      )}
      <div className="flex min-w-0 items-end gap-2">
        <PanelField label={t("from")} className="min-w-0 flex-1 sm:w-40 sm:flex-none lg:flex-1">
          <PeriodDate
            value={from}
            onCommit={(v) => {
              period?.onManual();
              onRange({ from: v });
            }}
            aria-label={t("from")}
          />
        </PanelField>
        <span aria-hidden className="flex h-10 items-center text-muted sm:h-8">
          -
        </span>
        <PanelField label={t("to")} className="min-w-0 flex-1 sm:w-40 sm:flex-none lg:flex-1">
          <PeriodDate
            value={to}
            onCommit={(v) => {
              period?.onManual();
              onRange({ to: v });
            }}
            aria-label={t("to")}
          />
        </PanelField>
      </div>
    </PanelRow>
  );
}
