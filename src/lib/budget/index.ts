// Shared budget domain helpers (pure, safe in both server and client).

export type AccountKind = "INCOME" | "COST";

/** Whether a BAS code belongs in a budget: 3xxx-8xxx (resultaträkningen). 1xxx and 2xxx (balansräkningen) are not budgeted. */
export function isResultAccount(accountCode: string): boolean {
  return /^[3-8]/.test(accountCode.trim());
}

/**
 * Which side an account belongs on: 3xxx income, 4xxx-8xxx cost. The code decides, matching the ledger.
 * Total: a balance account picked before they were refused reads as a cost.
 */
export function effectiveKind(accountCode: string): AccountKind {
  return /^3/.test(accountCode.trim()) ? "INCOME" : "COST";
}

// Identifies a sheet: the cost-centre code, or for a detached sheet its own id behind a "#".
// The "#" keeps it out of the formula language (codes are bare words), so detached sheets never pool totals.
export function sheetKey(cc: { id: string; costCenter?: { code: string } | null }): string {
  return cc.costCenter?.code ?? `#${cc.id}`;
}

// A detached sheet's fallback name. Swedish because callers store it (a cloned sheet's label); screens pass a translated one.
const UNNAMED_SHEET = "Namnlöst kostnadsställe";

export function sheetName(
  cc: { label?: string | null; costCenter?: { name: string } | null },
  unnamed: string = UNNAMED_SHEET,
): string {
  return cc.costCenter?.name ?? (cc.label?.trim() || unnamed);
}
