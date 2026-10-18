"use client";

// The drink type as a small coloured mark before a product's name, so a list
// of sixty products can be scanned by kind before it is read: the beer is the
// amber ones, the spirits the blue. The name of the type is its title and its
// accessible name; the list still has the type as a column to sort and filter
// by.
//
// The colours are the app's own soft tints (globals.css), one per type, and
// never the status ones carrying a meaning of their own: amber here is beer,
// not a warning. Each mark also has its own glyph, so the type is not told by
// colour alone.
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

// Drawn in a 16-unit box, stroked in the mark's colour.
const GLYPH: Record<Category, React.ReactNode> = {
  // A glass of beer with its handle.
  OL: <path d="M4 4h6v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zM10 6h1.5a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1H10M4 7h6" />,
  // A can.
  OVRIG_JASTDRYCK: <path d="M5 3h6M5 13h6M5 3a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1M11 3a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1M4 6h8" />,
  // A wine glass.
  VIN: <path d="M5 2h6l-.5 4a2.5 2.5 0 0 1-5 0zM8 8.5V13M5.5 13.5h5" />,
  // A bottle.
  SPRITDRYCK: <path d="M7 2h2v3l1.5 2v6.5a.5.5 0 0 1-.5.5H6a.5.5 0 0 1-.5-.5V7L7 5z" />,
  ALKOHOLDRYCKSLIKNANDE: <circle cx="8" cy="8" r="3.5" />,
};

export function CategoryMark({
  category,
  size = "sm",
}: {
  category: Category;
  /** `lg` beside a page's title. */
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
