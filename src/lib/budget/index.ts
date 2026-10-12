// Shared budget domain helpers (pure, safe in both server and client).

export type AccountKind = "INCOME" | "COST";

/**
 * Whether a BAS code is something a budget has any business holding.
 *
 * 3xxx–8xxx are the resultaträkning: what the year earns and what it spends,
 * which is the whole of what a budget is about. 1xxx and 2xxx are the
 * balansräkning, what the section owns and owes, and those are not budgeted.
 * They are what a year *leaves behind*, and a section's bank balance sitting in
 * a column of costs is a number that means nothing there.
 *
 * They used to be pickable, and `effectiveKind` quietly called every one of
 * them a cost, so a mistyped 1930 became an expense line nobody could see was
 * wrong.
 */
export function isResultAccount(accountCode: string): boolean {
  return /^[3-8]/.test(accountCode.trim());
}

/**
 * Which side of the sheet an account belongs on: 3xxx is income, 4xxx–8xxx is
 * cost.
 *
 * The code decides, and nothing else does. There used to be a per-account
 * override, set by dragging an account card from one section to the other, so a
 * cost account could be filed under Intäkter. That is now a thing the sheet
 * cannot express: an account is on the side its number puts it on, which is the
 * side the ledger will report it on whatever a budget says.
 *
 * Total, so a sheet drawn from data older than that rule still renders. A
 * balance account that was picked before they were refused reads as a cost,
 * exactly as it did then; `isResultAccount` is what stops another being added.
 */
export function effectiveKind(accountCode: string): AccountKind {
  return /^3/.test(accountCode.trim()) ? "INCOME" : "COST";
}

// What identifies one sheet in a budget: the cost-centre code, or, for a
// sheet not linked to a cost centre, its own id behind a "#".
//
// Every per-account figure in a budget is keyed `<sheet>:<accountCode>`, so
// the key has to be unique per sheet or two detached sheets would pool their
// totals. The "#" is what keeps a detached sheet out of the formula language:
// codes are bare words, so `account(CC, 3010)` and `CC!C7` cannot name one, and
// it becomes referenceable the moment a cost centre is picked for it.
export function sheetKey(cc: { id: string; costCenter?: { code: string } | null }): string {
  return cc.costCenter?.code ?? `#${cc.id}`;
}

// A detached sheet's fallback name, when it hasn't even been given a label.
// The default is Swedish because the callers that fall back to it *store* what
// they build (a cloned sheet's label); a screen passes its own translated one.
const UNNAMED_SHEET = "Namnlöst kostnadsställe";

// What to call a sheet: the cost centre it is linked to, else its own label.
export function sheetName(
  cc: { label?: string | null; costCenter?: { name: string } | null },
  unnamed: string = UNNAMED_SHEET,
): string {
  return cc.costCenter?.name ?? (cc.label?.trim() || unnamed);
}
