// What an uthyrning costs, in one place. The lines are the price and a discount is a
// percentage per line (100 per cent off is a free loan). Pure, shared by the form, the
// routes and the document so the figures cannot come apart.

export interface PricedLine {
  quantity: number;
  unitPriceOre: number;
  discountPercent: number;
}

interface LinePricing {
  grossOre: number;
  discountPercent: number;
  discountOre: number;
  netOre: number;
}

interface RentalPricing {
  subtotalOre: number;
  discountOre: number;
  totalOre: number;
  /** Whether anything was discounted, so a page can leave the column out. */
  anyDiscount: boolean;
}

/** A finite number, or zero. The form holds strings while typing, and an empty box must not give "NaN kr". */
const num = (v: number): number => (Number.isFinite(v) ? v : 0);

/**
 * One line, priced. The discount is rounded once, on the line, in whole öre (rounding a
 * per-unit price first would shift the total). The percentage is clamped, not rejected.
 */
export function linePricing(line: PricedLine): LinePricing {
  const grossOre = Math.round(num(line.unitPriceOre) * num(line.quantity));
  const discountPercent = Math.min(Math.max(Math.round(num(line.discountPercent)), 0), 100);
  const discountOre = Math.round((grossOre * discountPercent) / 100);
  return { grossOre, discountPercent, discountOre, netOre: grossOre - discountOre };
}

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
