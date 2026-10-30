import { cn } from "@/lib/ui/utils";

// Money, set the way a finance product sets money: one figure, one size, one
// weight, "1 247,50 kr". The öre used to sit a size down and in grey, behind a
// gap, which read as a price tag ("1 247 ,50 kr") rather than as a sum, and a
// column of them did not read down as one.
//
// This is also the one place the öre-in-the-database constraint surfaces
// visually. `lib/domain/money.ts` converts; this decides how the figure reads
// once it gets here.

// Built once, at module scope: this runs per table cell.
const MONEY = new Intl.NumberFormat("sv-SE", {
  style: "currency",
  currency: "SEK",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const SIZES = {
  sm: "text-sm",
  md: "text-base",
  // The figure a page is about: a stat card, a verifikation total.
  lg: "text-2xl tracking-[-0.022em]",
  xl: "text-[32px] leading-none tracking-[-0.026em]",
} as const;

export function Amount({
  value,
  size = "sm",
  /**
   * Colour a negative figure. A negative belopp on an utlägg is a return (see
   * lib/domain/matching.ts), so it is money coming back to the section and it
   * is coloured `success`. It used to be `danger`, which put the one good
   * figure in the list in the colour the app otherwise saves for something
   * being wrong.
   *
   * This only knows about the sign, so it belongs on figures where a negative
   * one is a return and nothing else. A figure where down is bad (an overspent
   * budget line, a result that has gone under) colours itself through
   * `className`. Note that the sign and the good news do not line up the same
   * way everywhere: on a bank statement money comes *in* as a positive and
   * `bankAmountColumn` greens that instead.
   */
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
