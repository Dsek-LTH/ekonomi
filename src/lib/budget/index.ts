// Shared budget domain helpers (pure, safe in both server and client).

export type AccountKind = "INCOME" | "COST";

// BAS chart: 3xxx accounts are revenue (intäkter); everything else is a cost.
export function inferKind(accountCode: string): AccountKind {
  return /^3/.test(accountCode.trim()) ? "INCOME" : "COST";
}

// The effective kind: an explicit override wins over the code-based inference.
export function effectiveKind(
  accountCode: string,
  override: AccountKind | null | undefined,
): AccountKind {
  return override ?? inferKind(accountCode);
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
