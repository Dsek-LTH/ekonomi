import { cn } from "@/lib/ui/utils";

// One figure, one size: "1 247,50 kr". Values arrive in kronor (lib/domain/money.ts converts from öre).

// Built once at module scope: this runs per table cell.
const MONEY = new Intl.NumberFormat("sv-SE", {
  style: "currency",
  currency: "SEK",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const SIZES = {
  sm: "text-sm",
  md: "text-base",
  lg: "text-2xl tracking-[-0.022em]",
  xl: "text-[32px] leading-none tracking-[-0.026em]",
} as const;

export function Amount({
  value,
  size = "sm",
  /** Colours a negative figure `success`: a negative belopp on an utlägg is a return (lib/domain/matching.ts). Other figures colour via className. */
  signed = false,
  className,
}: {
  value: number;
  size?: keyof typeof SIZES;
  signed?: boolean;
  className?: string;
}) {
  const negative = value < 0;

  return (
    <span
      className={cn(
        "tnum whitespace-nowrap font-medium",
        SIZES[size],
        signed && negative && "text-success",
        className,
      )}
    >
      {MONEY.format(value)}
    </span>
  );
}
