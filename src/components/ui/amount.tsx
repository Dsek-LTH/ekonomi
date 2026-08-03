import { cn } from "@/lib/ui/utils";

// Money, set the way a finance product sets money.
//
// A belopp is three things of different importance welded into one string:
// the kronor, the öre, and the currency. Rendered flat — "1 247,50 kr" — they
// all shout equally and a column of them is a wall. Rendered in weight order,
// the kronor carry the row and the öre sit where they belong: present, exact,
// and quiet.
//
// This is also the one place the öre-in-the-database constraint surfaces
// visually. `lib/domain/money.ts` converts; this decides how the two halves of
// the figure read once they get here.

// Split once, at module scope — this runs per table cell.
const PARTS = new Intl.NumberFormat("sv-SE", {
  style: "currency",
  currency: "SEK",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const SIZES = {
  // In a table row: the kronor sit at the row's own size, öre a step down.
  sm: { major: "text-sm", minor: "text-[11px]" },
  md: { major: "text-base", minor: "text-xs" },
  // The figure a page is about — a stat card, a verifikation total.
  lg: { major: "text-2xl tracking-[-0.022em]", minor: "text-sm" },
  xl: { major: "text-[32px] leading-none tracking-[-0.026em]", minor: "text-base" },
} as const;

export function Amount({
  value,
  size = "sm",
  /** Colour a negative figure — a return, or an overspent budget line. */
  signed = false,
  className,
}: {
  value: number;
  size?: keyof typeof SIZES;
  signed?: boolean;
  className?: string;
}) {
  const s = SIZES[size];
  const negative = value < 0;

  // formatToParts rather than a regex on the output: the group separator in
  // sv-SE is a non-breaking space and the decimal is a comma, and neither is
  // something to hard-code here.
  const parts = PARTS.formatToParts(value);
  const major = parts
    .filter((p) => ["minusSign", "integer", "group"].includes(p.type))
    .map((p) => p.value)
    .join("");
  const decimal = parts.find((p) => p.type === "decimal")?.value ?? ",";
  const fraction = parts.find((p) => p.type === "fraction")?.value ?? "00";

  return (
    <span
      className={cn(
        "tnum inline-flex items-baseline gap-[0.15em] whitespace-nowrap font-semibold",
        signed && negative && "text-danger",
        className,
      )}
    >
      <span className={s.major}>{major}</span>
      <span className={cn(s.minor, "font-medium text-muted")}>
        {decimal}
        {fraction}
      </span>
      <span className={cn(s.minor, "font-medium text-muted")}>kr</span>
    </span>
  );
}
