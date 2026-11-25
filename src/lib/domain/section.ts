// The section's own details. Levfaktura reads the organisation number to tell the section's
// own number on an invoice from the supplier's (lib/server/invoice-prefill.ts).
//
// Local on purpose, not read from Fortnox: the figures must not depend on an integration being
// connected, and a change should come as a reviewable diff.

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
