// Who the section is, as a document names it.
//
// ─────────────────────────────────────────────────────────────────────
//  THIS FILE IS THE ONE PLACE TO EDIT THE SECTION'S OWN DETAILS.
//
//  They are printed on the letterhead of every uthyrningsavtal the app draws,
//  which is a document somebody outside the section is bound by. Check them
//  against what the section is actually registered as before the first contract
//  goes out, and correct them here.
// ─────────────────────────────────────────────────────────────────────
//
// Local, and deliberately not read from the Fortnox connection.
//
// Fortnox holds a company name and an organisation number, and taking the
// letterhead from there was the first thing tried. It is the wrong source. It
// makes what a contract says about the section depend on an integration being
// connected, so a lapsed token changes the document; it makes the address
// unreviewable, since nobody sees it change; and it renders differently on a
// machine with no connection at all, which is every test run and every fresh
// checkout. What the section is called on a contract it issues is a decision,
// not a synced value, and a decision belongs in a file somebody reads in a
// diff.
//
// It is also why nothing here is async. Drawing a contract used to open a
// database connection to find out who was drawing it, on every render, and the
// live preview does that every few seconds.

export interface SectionIdentity {
  /** As the document names it, in the section's own spelling. */
  name: string;
  /** Organisationsnummer. Null only if the section genuinely has none. */
  orgNo: string | null;
  /** The street line of the postal address. */
  address: string | null;
  /** "223 63 Lund": postal code and town on one line, as an address is set. */
  postalLine: string | null;
}

const POSTAL_CODE = "223 63";
const CITY = "Lund";

export const SECTION: SectionIdentity = {
  name: "D-sektionen inom TLTH",
  orgNo: "845003-2878",
  address: "Ole Römers väg 3",
  postalLine: `${POSTAL_CODE} ${CITY}`,
};
