"use client";

// The drink type as a small coloured mark by the product name. Tints come from globals.css, not the status colours,
// and each type has its own glyph so colour is not the only cue.
import { useTranslations } from "next-intl";
import { cn } from "@/lib/ui/utils";

type Category = "OL" | "OVRIG_JASTDRYCK" | "VIN" | "SPRITDRYCK" | "ALKOHOLDRYCKSLIKNANDE";

const TONE: Record<Category, string> = {
  OL: "bg-warning-soft text-warning",
  OVRIG_JASTDRYCK: "bg-success-soft text-success",
  VIN: "bg-purple-soft text-purple",
  SPRITDRYCK: "bg-pay-card-soft text-pay-card",
  ALKOHOLDRYCKSLIKNANDE: "bg-surface text-muted",
};

const GLYPH: Record<Category, React.ReactNode> = {
  OL: (
    <path d="M4 4h6v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zM10 6h1.5a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1H10M4 7h6" />
  ),
  OVRIG_JASTDRYCK: (
    <path d="M5 3h6M5 13h6M5 3a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1M11 3a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1M4 6h8" />
  ),
  VIN: <path d="M5 2h6l-.5 4a2.5 2.5 0 0 1-5 0zM8 8.5V13M5.5 13.5h5" />,
  SPRITDRYCK: <path d="M7 2h2v3l1.5 2v6.5a.5.5 0 0 1-.5.5H6a.5.5 0 0 1-.5-.5V7L7 5z" />,
  ALKOHOLDRYCKSLIKNANDE: <circle cx="8" cy="8" r="3.5" />,
};

export function CategoryMark({
  category,
  size = "sm",
}: {
  category: Category;
  size?: "sm" | "lg";
}) {
  const t = useTranslations("stock");
  const name = t(`category.${category}`);
  return (
    <span
      role="img"
      aria-label={name}
      title={name}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-control",
        size === "lg" ? "size-8" : "size-6",
        TONE[category],
      )}
    >
      <svg
        viewBox="0 0 16 16"
        className={size === "lg" ? "size-5" : "size-4"}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        {GLYPH[category]}
      </svg>
    </span>
  );
}
