// What a cover page says, as plain data.
//
// This is the contract between the app and whatever typesets the page, and it
// is deliberately dull: strings and numbers, nothing from Prisma, nothing from
// the engine. Two things follow from that.
//
// The engine is swappable. `renderCover` takes this and returns PDF bytes; a
// LaTeX implementation would be a second file with the same signature and
// nothing else in the app would move. See cover/typst.ts.
//
// And the interesting half is testable without one. Turning an utlägg into
// these fields is where the decisions live (which name, which date, what a
// missing approver reads as), and `buildCoverData` can be asserted on with no
// binary installed anywhere. See lib/expense/document.ts.
//
// Everything here is pre-formatted, in Swedish, ready to be placed. The
// typesetter is not given amounts in öre and a locale to sort out: it is given
// "69,00 kr". A document that is archived beside a voucher cannot follow
// whoever happens to be looking at it, so there is one wording and this is
// where it is decided.

/** One cost-centre slice of the utlägg, with the attest that cleared it. */
interface ExpenseCoverAllocation {
  /** "SEKT05 - Sexmästeriet": code and name, as the ledger writes it. */
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
 * A mileage claim has no receipt to staple behind the cover. Nobody
 * photographs driving their own car, so what would otherwise be a second
 * document is a section of this one: the odometer at each end, the difference
 * between them, and what a kilometre was worth on the day. The readings are why
 * it is worth printing at all; a distance alone is a number somebody arrived
 * at, and these are what the car said.
 *
 * Null for every other kind of utlägg, whose underlag is a real receipt and
 * follows on the next page.
 */
export interface ExpenseCoverJourney {
  /** The journey's stops, already joined for the page: "Kårhuset, Lund →
   *  Snabbgross → Kårhuset, Lund", or a dash on a draft that has not said yet.
   *  Without it the page states a distance nobody can place, which is the one
   *  thing Skatteverket asks of a milersättning's underlag. */
  route: string;
  /** "12 300,0 km": the total odometer when the journey began. */
  odometerStart: string;
  odometerEnd: string;
  /** "42,0 km": the difference, which is the distance claimed. */
  distance: string;
  /** "2,50 kr/km", or a dash where the day had no rate. */
  rate: string;
}

/**
 * The dispens that let a late utlägg be filed, as the page states it.
 *
 * On the cover because this page is what is archived beside the voucher. An
 * utlägg filed after the section's own deadline was paid because somebody with
 * the authority to decided it should be, and a reader coming to the voucher a
 * year later has no other way to find that out. Without it the page shows a
 * receipt dated months before the claim and no explanation at all, which is the
 * one thing an underlag must not do.
 *
 * Null on every utlägg that was in time, which is nearly all of them.
 */
export interface ExpenseCoverWaiver {
  /** Who granted it. */
  by: string;
  /** ISO date it was granted. */
  at: string;
  /** Why, in their own words. */
  reason: string;
  /** "61 dagar efter köpet": how late the claim actually was, worked out in
   *  document.ts so the page states a fact rather than inviting a subtraction
   *  across two dates in different places. */
  lateness: string;
}

/**
 * Who konterade the utlägg, as the page states it.
 *
 * On the cover because Fortnox names the voucher after whoever sent it, the
 * bokförare. This page is filed with it, so it is where the kontering's author
 * can be read.
 */
export interface ExpenseCoverBooking {
  by: string;
  /** ISO date. */
  at: string;
  /** "Cia Ceder och Dan Dahl", or null where nobody else amended it. */
  amendedBy: string | null;
}

export interface ExpenseCoverData {
  /** "DEK26-0042". An utlägg with no reference yet falls back to its title. */
  reference: string;
  title: string;
  /** ISO date of the purchase, or null when nobody recorded one. */
  purchaseDate: string | null;
  /**
   * What to call that date. "Kvittodatum" for an utlägg with a receipt behind
   * it, "Resdag" for a milersättning, which has no receipt and whose date is
   * the day it was driven. It read "Sista resdag" from when a claim held a
   * sheet of journeys; one claim is one journey, so there is no last one to
   * distinguish. See lib/expense/document.ts.
   */
  dateLabel: string;
  /** "Privat utlägg" / "Sektionskort", already worded. */
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
  /** The journey, for a milersättning. Null for anything else. See above. */
  journey: ExpenseCoverJourney | null;
  /** The dispens from the filing deadline, where one was given. Null
   *  otherwise. See above. */
  waiver: ExpenseCoverWaiver | null;
  /** Who konterade it. Null on an utlägg not yet konterat. See above. */
  booking: ExpenseCoverBooking | null;
}

/**
 * A cover page, as PDF bytes.
 *
 * The one function an engine has to provide. Nothing in the signature says how
 * A subprocess, a native module, an HTTP call to a sidecar all fit, which is
 * the point of it being this narrow.
 */
export type CoverRenderer = (data: ExpenseCoverData) => Promise<Uint8Array>;
