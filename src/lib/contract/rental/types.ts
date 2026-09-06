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

/** One party, as the signature block names them. */
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
  /** "250,00 kr", already formatted. */
  unitPrice: string;
  /** What the whole line is let for: quantity times unit price. */
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
  };
  /** Who the gear is going to, as one line: the organisation or the person. */
  counterparty: string;
  counterpartyOrgNo: string | null;

  title: string;
  /** The day the document was drawn, not the day it was signed. */
  drawn: string;

  pickupAt: string;
  returnAt: string;
  purpose: string | null;
  place: string | null;

  lines: RentalContractLine[];
  /** The rent as agreed, which is not necessarily the lines added up: a rental
   *  can be priced as a whole, and lending to another section for nothing is
   *  a real and common case. */
  price: string;
  deposit: string;
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
