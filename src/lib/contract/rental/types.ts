// What an uthyrningsavtal says, as plain data.
//
// The contract between the app and whatever typesets the document, shaped after
// expense/cover/types.ts and dull for the same two reasons. The engine is
// swappable, since `renderRentalContract` takes this and returns PDF bytes. And
// the interesting half is testable without one: turning a contract row into
// these fields is where the decisions live, and it can be asserted on with no
// binary installed anywhere.
//
// Everything here is pre-formatted, in Swedish, ready to be placed. The
// typesetter is not handed öre and a locale to sort out, it is handed
// "1 250,00 kr". A document that a counterparty is bound by cannot follow
// whoever happens to be looking at it.
import type { TermsSection } from "./terms";

/** One party, as the signature block and the party block name them. */
export interface RentalParty {
  name: string;
  /** "Skattmästare", "Ordförande F-sektionen". Null where none was given. */
  title: string | null;
  /** The organisation they sign for, when they are not signing for themselves. */
  orgName: string | null;
  orgNo: string | null;
  email: string | null;
  phone: string | null;
}

/** One line of gear on the document. */
export interface RentalContractLine {
  description: string;
  /** "2 st". A unit, because a bare number in a column reads as a price. */
  quantity: string;
  /** "250,00 kr", already formatted. The list price before any discount. */
  unitPrice: string;
  /** "50 %", or null where nothing came off this line. Null on every line is
   *  how `anyDiscount` comes to be false and the column is left out. */
  discount: string | null;
  /** What the line actually costs: quantity times unit price, less its own
   *  discount. */
  lineTotal: string;
  /** What one of these costs to replace. The figure the liability clause
   *  points at, which is why it is on the page and not only in the catalogue. */
  replacementValue: string;
}

export interface RentalContractData {
  /** The section, as the document names it. Read from the Fortnox connection
   *  where there is one, so the lessor's name and organisation number are the
   *  ones the section actually trades under. */
  lessor: {
    name: string;
    orgNo: string | null;
    /** The section's own postal address, for the letterhead. Set the way the
     *  renter's is: the street on one line, "223 63 Lund" on the next. */
    address: string | null;
    postalLine: string | null;
  };
  /** Who the gear is going to, as one line: the organisation or the person. */
  counterparty: string;
  /** Organisationsnummer or personnummer, whichever the renter has. */
  counterpartyOrgNo: string | null;
  /**
   * Where they can be reached on paper, already set as the document prints it:
   * the street on one line, then "223 62 Lund" on the next. Null on a contract
   * drawn before the form asked for it.
   */
  counterpartyAddress: string | null;
  counterpartyPostalLine: string | null;

  title: string;
  /** The day the document was drawn, not the day it was signed. */
  drawn: string;

  /**
   * The period, as ISO days, or null where it has not been chosen yet.
   *
   * Nullable only because of the live preview: a stored rental always has both
   * (the column is not nullable), but the form draws this document while it is
   * still being filled in, and a preview that refuses to render until a date is
   * typed is a preview that is blank exactly when it would be most use. The
   * template rules a dash where a date will go.
   */
  pickupAt: string | null;
  returnAt: string | null;
  purpose: string | null;
  place: string | null;

  lines: RentalContractLine[];
  /** The lines added up, before any discount. */
  subtotal: string;
  /** Whether any line was discounted, so the table can leave the column out
   *  rather than print a zero against every row. */
  anyDiscount: boolean;
  /**
   * What was taken off, or null when nothing was.
   *
   * Null rather than "0,00 kr" so the template can leave the row out. A
   * document that states a discount of nothing invites the question of what it
   * was meant to say.
   */
  discount: string | null;
  /** The rent: the subtotal less the discount. Zero is a real answer, and how
   *  a free loan to another section is written. */
  price: string;
  /**
   * When the rent falls due, or null for "at pickup", which is what the villkor
   * say when no date is given. Printed under the rent, because a payment clause
   * that refers to a date the page does not carry is unenforceable.
   */
  paymentDue: string | null;
  /** Every line's replacement value, added up. The number that says what is
   *  actually at stake. */
  totalReplacement: string;

  /**
   * The signature blocks, in the order they are drawn.
   *
   * Both nullable, because both can genuinely be absent: a contract drawn
   * before the renter has named who will sign for them, or one whose party row
   * was removed afterwards. The template rules a line with a dash under it
   * rather than omitting the block, so the document is still signable by hand.
   */
  sectionParty: RentalParty | null;
  counterpartyParty: RentalParty | null;

  terms: readonly TermsSection[];
  termsVersion: string;
}

/** What draws one. Implemented by rental/typst.ts; nothing above it knows
 *  there is a typesetter. */
export type RentalContractRenderer = (data: RentalContractData) => Promise<Uint8Array>;
