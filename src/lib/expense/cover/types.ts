// What a cover page says, as plain data: the contract with whatever typesets it (cover/typst.ts),
// so the engine is swappable and buildCoverData (lib/expense/document.ts) is testable without one.
// Pre-formatted Swedish, because an archived page cannot follow whoever is looking.

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

/** The journey behind a milersättning: odometer at each end, the difference and the kr/km. Null for other kinds. */
export interface ExpenseCoverJourney {
  /** The stops, joined for the page ("Kårhuset, Lund → Snabbgross"), or a dash on a draft. */
  route: string;
  /** "12 300,0 km": the total odometer when the journey began. */
  odometerStart: string;
  odometerEnd: string;
  /** "42,0 km": the difference, which is the distance claimed. */
  distance: string;
  /** "2,50 kr/km", or a dash where the day had no rate. */
  rate: string;
}

/** The dispens that let a late utlägg be filed. On the cover because it is archived beside the voucher. Null when in time. */
export interface ExpenseCoverWaiver {
  /** Who granted it. */
  by: string;
  /** ISO date it was granted. */
  at: string;
  /** Why, in their own words. */
  reason: string;
  /** "61 dagar efter köpet": worked out in document.ts. */
  lateness: string;
}

/** Who konterade the utlägg. Fortnox names the voucher after the bokförare, so the page says who the kontering's author is. */
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
  /** "Kvittodatum" with a receipt, "Resdag" for a milersättning. */
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

/** A cover page, as PDF bytes: the one function an engine provides. */
export type CoverRenderer = (data: ExpenseCoverData) => Promise<Uint8Array>;
