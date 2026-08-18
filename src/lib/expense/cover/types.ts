// What a cover page says, as plain data.
//
// This is the contract between the app and whatever typesets the page, and it
// is deliberately dull: strings and numbers, nothing from Prisma, nothing from
// the engine. Two things follow from that.
//
// The engine is swappable. `renderCover` takes this and returns PDF bytes; a
// LaTeX implementation would be a second file with the same signature and
// nothing else in the app would move — see cover/typst.ts.
//
// And the interesting half is testable without one. Turning an utlägg into
// these fields is where the decisions live (which name, which date, what a
// missing approver reads as), and `buildCoverData` can be asserted on with no
// binary installed anywhere — see lib/expense/document.ts.
//
// Everything here is pre-formatted, in Swedish, ready to be placed. The
// typesetter is not given amounts in öre and a locale to sort out: it is given
// "69,00 kr". A document that is archived beside a voucher cannot follow
// whoever happens to be looking at it, so there is one wording and this is
// where it is decided.

/** One cost-centre slice of the utlägg, with the attest that cleared it. */
export interface ExpenseCoverAllocation {
  /** "SEKT05 · Sexmästeriet" — code and name, as the ledger writes it. */
  costCenter: string;
  amount: string;
  /** The submitter's note, or null. Rendered as a dash. */
  comment: string | null;
  /** Who attested this slice, or null where nobody has yet. */
  approvedBy: string | null;
  /** ISO date, or null. */
  approvedAt: string | null;
}

export interface ExpenseCoverData {
  /** "DEK26-0042". An utlägg with no reference yet falls back to its title. */
  reference: string;
  title: string;
  /** ISO date of the purchase, or null when nobody recorded one. */
  purchaseDate: string | null;
  /** "Privat utlägg" / "Sektionskort" — already worded. */
  paymentType: string;
  /** ISO date the cover was drawn. */
  created: string;
  submitter: {
    name: string;
    /** StiL-ID, or null for a user who has none on file. */
    studentId: string | null;
  };
  total: string;
  allocations: ExpenseCoverAllocation[];
}

/**
 * A cover page, as PDF bytes.
 *
 * The one function an engine has to provide. Nothing in the signature says how
 * — a subprocess, a native module, an HTTP call to a sidecar all fit — which is
 * the point of it being this narrow.
 */
export type CoverRenderer = (data: ExpenseCoverData) => Promise<Uint8Array>;
