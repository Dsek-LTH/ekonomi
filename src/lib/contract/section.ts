// The section's own details, printed on the letterhead of every uthyrningsavtal. Check them
// against the section's registration before the first contract goes out.
//
// Local on purpose, not read from Fortnox: a contract's wording must not depend on an
// integration being connected, and the address should change in a reviewable diff.

interface SectionIdentity {
  name: string;
  orgNo: string | null;
  address: string | null;
  postalLine: string | null;
}

// A box, not the kårhus street: post sent to the building does not reach the section.
const POSTAL_CODE = "221 00";
const CITY = "Lund";

export const SECTION: SectionIdentity = {
  name: "D-sektionen inom TLTH",
  orgNo: "845003-2878",
  address: "Box 118",
  postalLine: `${POSTAL_CODE} ${CITY}`,
};
