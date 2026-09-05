// BAS chart-of-accounts structure for the Utfall reports.
//
// The ledger stores raw debit/credit (positive = debit, as in SIE). Fortnox's
// reports instead show income and equity/liabilities as positive figures, so
// each section declares the orientation used to turn a raw net into a display
// amount. With that convention a result report's sections sum to the period's
// result, and a balance report's sections sum to zero.

export type ReportKind = "RESULT" | "BALANCE";

// How to turn a raw net (debit − credit, öre) into the displayed amount.
//   "debit":  assets and costs, shown as-is
//   "credit": income, equity and liabilities, sign-flipped
type Orientation = "debit" | "credit";

// `key` names the section in messages: `ledger.section.<key>` for the heading
// and `ledger.sectionTotal.<key>` for its total row.
export interface BasSection {
  key: string;
  from: number; // inclusive BAS account number
  to: number; // inclusive
  orientation: Orientation;
}

// Balansräkning, printed with raw signs the way Fortnox does: assets positive,
// equity and liabilities negative. Every section is therefore debit-oriented.
//
// That makes the report's bottom line meaningful rather than zero. Since
//   assets = equity + liabilities + result,
// summing every section leaves exactly the period's result: the figure Fortnox
// labels "Beräknat resultat", and it must match the result report's total.
const BALANCE_SECTIONS: BasSection[] = [
  { key: "anlaggning", from: 1000, to: 1399, orientation: "debit" },
  { key: "omsattning", from: 1400, to: 1999, orientation: "debit" },
  { key: "egetkapital", from: 2000, to: 2099, orientation: "debit" },
  { key: "obeskattade", from: 2100, to: 2199, orientation: "debit" },
  { key: "avsattningar", from: 2200, to: 2299, orientation: "debit" },
  { key: "langfristiga", from: 2300, to: 2399, orientation: "debit" },
  { key: "kortfristiga", from: 2400, to: 2999, orientation: "debit" },
];

// Resultaträkning. Income is credit-oriented (so it reads positive); every cost
// section is credit-oriented too, which makes costs read negative, matching how
// Fortnox prints them, and letting the sections simply add up to the result.
const RESULT_SECTIONS: BasSection[] = [
  { key: "intakter", from: 3000, to: 3999, orientation: "credit" },
  { key: "varor", from: 4000, to: 4999, orientation: "credit" },
  { key: "externa", from: 5000, to: 6999, orientation: "credit" },
  { key: "personal", from: 7000, to: 7699, orientation: "credit" },
  { key: "avskrivningar", from: 7700, to: 7899, orientation: "credit" },
  { key: "ovriga", from: 7900, to: 7999, orientation: "credit" },
  { key: "finansiella", from: 8000, to: 8799, orientation: "credit" },
  { key: "bokslut", from: 8800, to: 8999, orientation: "credit" },
];

export function sectionsFor(kind: ReportKind): BasSection[] {
  return kind === "BALANCE" ? BALANCE_SECTIONS : RESULT_SECTIONS;
}

// The account-number span a report covers. Anything outside it is not part of
// that report (a 1930 row has no place in a result report, and vice versa).
export function accountRangeFor(kind: ReportKind): { from: number; to: number } {
  return kind === "BALANCE" ? { from: 1000, to: 2999 } : { from: 3000, to: 8999 };
}

// Raw net (debit − credit) → the figure the report displays.
export function orient(net: number, orientation: Orientation): number {
  return orientation === "credit" ? -net : net;
}

// The bottom line each report closes with is `ledger.calculatedResult`. Both
// reports close on the period's result: the result report reaches it from income
// minus costs, the balance report from assets minus equity and liabilities. They
// must agree, which is why they share one label.
