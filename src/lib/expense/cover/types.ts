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

/**
 * The journey behind a milersättning, as the page states it.
 *
 * A mileage claim has no receipt to staple behind the cover — nobody
 * photographs driving their own car — so what would otherwise be a second
 * document is a section of this one: the odometer at each end, the difference
 * between them, and what a kilometre was worth on the day. The readings are why
 * it is worth printing at all; a distance alone is a number somebody arrived
 * at, and these are what the car said.
 *
 * Null for every other kind of utlägg, whose underlag is a real receipt and
 * follows on the next page.
 */
export interface ExpenseCoverJourney {
  /** "12 300,0 km" — the odometer when the journey began. */
  odometerStart: string;
  odometerEnd: string;
  /** "42,0 km" — the difference, which is the distance claimed. */
  distance: string;
  /** "2,50 kr/km", or a dash where the day had no rate. */
  rate: string;
}

export interface ExpenseCoverData {
  /** "DEK26-0042". An utlägg with no reference yet falls back to its title. */
  reference: string;
  title: string;
  /** ISO date of the purchase, or null when nobody recorded one. */
  purchaseDate: string | null;
  /**
   * What to call that date. "Kvittodatum" for an utlägg with a receipt behind
   * it, "Sista resdag" for a milersättning, which has no receipt and whose date
   * is the day of its last journey — see lib/expense/document.ts.
   */
  dateLabel: string;
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
  /** The journey, for a milersättning. Null for anything else — see above. */
  journey: ExpenseCoverJourney | null;
}

/**
 * A cover page, as PDF bytes.
 *
 * The one function an engine has to provide. Nothing in the signature says how
 * — a subprocess, a native module, an HTTP call to a sidecar all fit — which is
 * the point of it being this narrow.
 */
export type CoverRenderer = (data: ExpenseCoverData) => Promise<Uint8Array>;
