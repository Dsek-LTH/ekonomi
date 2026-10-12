// What an uthyrning costs, worked out in one place.
//
// There used to be two places to say what a rental was worth: a price on every
// line, and a "Hyra" field beside them that was typed by hand and won. Nothing
// on the screen said which of the two the renter would be charged, and the two
// disagreed by default, because the lines came from the catalogue and the field
// started empty.
//
// So the lines are the price. What comes off them is a percentage per line,
// which is how a discount is actually given: the speakers at half because they
// are going to another section, the mixer at full because it is not. One figure
// for the whole rental could express the total but never the reason, and a line
// lent at 100 per cent off is how a free loan is now written.
//
// Pure, and shared by the form, the create route, the patch route and the
// document, so the figure the renter is shown, the figure that lands in the
// database and the figure on the page cannot come apart.

export interface PricedLine {
  quantity: number;
  /** The list price for one, before anything comes off. */
  unitPriceOre: number;
  /** 0 to 100. Anything outside is clamped; see `linePricing`. */
  discountPercent: number;
}

interface LinePricing {
  /** Quantity times unit price: what the line would cost undiscounted. */
  grossOre: number;
  /** The percentage actually applied, after clamping. */
  discountPercent: number;
  /** What that percentage comes to in öre. */
  discountOre: number;
  /** What the line costs: gross less discount. */
  netOre: number;
}

interface RentalPricing {
  /** Every line's gross, added up. What an invoice calls the subtotal. */
  subtotalOre: number;
  /** Every line's discount, added up. */
  discountOre: number;
  /** What is owed: the subtotal less the discounts. Never negative. */
  totalOre: number;
  /** Whether anything was discounted at all, so a page can leave the column
   *  out rather than print a row of zeroes. */
  anyDiscount: boolean;
}

/** A number that is actually one, or zero. The form holds these as strings
 *  while somebody is typing, and one empty box must not turn a total into
 *  "NaN kr". */
const num = (v: number): number => (Number.isFinite(v) ? v : 0);

/**
 * One line, priced.
 *
 * The discount is rounded to whole öre, and rounded once, on the line. Rounding
 * the percentage into a per-unit price first and multiplying up instead would
 * put the error in the total and make three of the same item cost a different
 * amount than three separate lines of one.
 *
 * The percentage is clamped rather than rejected: both ends are reachable by
 * ordinary use of a number field, and neither is worth stopping a form for.
 */
export function linePricing(line: PricedLine): LinePricing {
  const grossOre = Math.round(num(line.unitPriceOre) * num(line.quantity));
  const discountPercent = Math.min(Math.max(Math.round(num(line.discountPercent)), 0), 100);
  const discountOre = Math.round((grossOre * discountPercent) / 100);
  return { grossOre, discountPercent, discountOre, netOre: grossOre - discountOre };
}

/** Every line, and the three figures the document prints under them. */
export function rentalPricing(lines: readonly PricedLine[]): RentalPricing {
  const priced = lines.map(linePricing);
  const subtotalOre = priced.reduce((sum, l) => sum + l.grossOre, 0);
  const discountOre = priced.reduce((sum, l) => sum + l.discountOre, 0);
  return {
    subtotalOre,
    discountOre,
    totalOre: subtotalOre - discountOre,
    anyDiscount: priced.some((l) => l.discountPercent > 0),
  };
}
