"use client";

// The pieces of a phone sheet that picks products by count: Flytta and the board's Nytt uttag. A search with a scan
// button beside it, and a row per product with a stepper that counts single units.
import { useTranslations } from "next-intl";
import { IconButton } from "@/components/ui/icon-button";
import { IconMinus, IconPlus, IconScan } from "@/components/ui/icons";
import { SearchInput } from "@/components/ui/search-input";
import { FieldAction } from "@/components/ui/field";
import { cn } from "@/lib/ui/utils";

/** The search field and the scan button, as one row of controls. */
export function SearchScanRow({
  query,
  onQuery,
  placeholder,
  onScan,
}: {
  query: string;
  onQuery: (query: string) => void;
  placeholder: string;
  onScan: () => void;
}) {
  const t = useTranslations("stock.stepper");
  return (
    // The scanner inside the search, at its end: one control, as the barcode field on a product has it.
    <SearchInput
      value={query}
      onChange={(e) => onQuery(e.target.value)}
      placeholder={placeholder}
      aria-label={placeholder}
      action={
        <FieldAction label={t("scan")} onClick={onScan}>
          <IconScan />
        </FieldAction>
      }
    />
  );
}

/** One product: its name, a line under it, and a stepper held between nothing and `max`. */
export function StepperRow({
  name,
  detail,
  units,
  max,
  onChange,
}: {
  name: string;
  /** What the line under the name says while there is some left (what is held, the price). */
  detail: React.ReactNode;
  units: number;
  max: number;
  onChange: (units: number) => void;
}) {
  const t = useTranslations("stock.stepper");
  const empty = max <= 0;

  return (
    <li className={cn("flex items-center gap-3 px-inset py-2.5", units > 0 && "bg-surface/60")}>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{name}</p>
        <p className="text-xs text-muted">
          {empty ? <span className="text-warning">{t("noneLeft")}</span> : detail}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <IconButton
          label={t("less", { name })}
          disabled={units <= 0}
          onClick={() => onChange(units - 1)}
          className="size-11 border border-border"
        >
          <IconMinus className="size-5" />
        </IconButton>
        <input
          inputMode="numeric"
          value={units === 0 ? "" : String(units)}
          placeholder="0"
          onChange={(e) => onChange(Number(e.target.value.replace(/[^0-9]/g, "")) || 0)}
          disabled={empty}
          aria-label={t("units", { name })}
          className="h-11 w-14 rounded-control border border-border bg-background text-center text-base font-semibold tabular-nums focus-inset disabled:opacity-50"
        />
        <IconButton
          label={t("more", { name })}
          disabled={empty || units >= max}
          onClick={() => onChange(units + 1)}
          className="size-11 border border-border"
        >
          <IconPlus className="size-5" />
        </IconButton>
      </div>
    </li>
  );
}
