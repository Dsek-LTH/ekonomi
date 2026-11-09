// An uthyrningsavtal as plain data for whatever typesets it (shaped after
// expense/cover/types.ts). Everything is pre-formatted Swedish ("1 250,00 kr"), since a
// document two parties are bound by cannot follow the viewer's locale.
import type { TermsSection } from "./terms";

export interface RentalContractLine {
  description: string;
  /** "2 st": with a unit, since a bare number in a column reads as a price. */
  quantity: string;
  /** "250,00 kr", the list price before any discount. */
  unitPrice: string;
  /** "50 %", or null where nothing came off. Null on every line makes `anyDiscount` false. */
  discount: string | null;
  /** Quantity times unit price, less the line's discount. */
  lineTotal: string;
  /** Replacement cost, which the liability clause points at. */
  replacementValue: string;
}

export interface RentalContractData {
  /** The section, as the document names it. */
  lessor: {
    name: string;
    orgNo: string | null;
    /** The section's postal address for the letterhead. */
    address: string | null;
    postalLine: string | null;
  };
  counterparty: string;
  counterpartyOrgNo: string | null;
  /** Where they can be reached on paper, set as printed ("223 62 Lund" on the second line). Null on older contracts. */
  counterpartyAddress: string | null;
  counterpartyPostalLine: string | null;
  counterpartyEmail: string | null;
  counterpartyPhone: string | null;

  title: string;
  drawn: string;

  /**
   * The period as ISO days. Null only in the live preview, which draws before dates are
   * chosen (the template rules a dash).
   */
  pickupAt: string | null;
  returnAt: string | null;
  purpose: string | null;

  lines: RentalContractLine[];
  subtotal: string;
  /** Whether any line was discounted, so the table can leave the column out. */
  anyDiscount: boolean;
  /** What was taken off, or null so the template leaves the row out. */
  discount: string | null;
  /** The rent: subtotal less discount. Zero is real (a free loan). */
  price: string;
  /** Every line's replacement value added up. */
  totalReplacement: string;

  /** Signature blocks to draw for the renter; at least one is always drawn. */
  signatureCount: number;

  terms: readonly TermsSection[];
  termsVersion: string;
}

/** What draws one. Implemented by rental/typst.ts. */
export type RentalContractRenderer = (data: RentalContractData) => Promise<Uint8Array>;
