// Comparing what an invoice says to pay to with what the supplier register
// says. The check that stands between a forged invoice and the section's money:
// "same supplier, new bankgiro" is how invoice fraud is done.
//
// Pure. The register is Fortnox's, read by the export route.

/** A bankgiro or plusgiro as digits only, so "5050-1055" and "50501055" are the
 *  same number. Null for nothing. */
export const giroDigits = (giro: string | null | undefined): string | null => {
  const d = (giro ?? "").replace(/\D/g, "");
  return d || null;
};

export type GiroMismatch =
  | null
  /** The invoice names a bankgiro or plusgiro the register does not have. */
  | { kind: "differs"; field: "bankgiro" | "plusgiro"; invoice: string; register: string | null };

/**
 * Whether the invoice asks to be paid somewhere the supplier register does not
 * know. Only a number the invoice prints is checked: an invoice with neither
 * is paid to whatever the register has, which is the safe way round.
 */
export function giroMismatch(
  invoice: { bankgiro: string | null; plusgiro: string | null },
  register: { bankgiro: string | null; plusgiro: string | null },
): GiroMismatch {
  for (const field of ["bankgiro", "plusgiro"] as const) {
    const mine = giroDigits(invoice[field]);
    if (mine && mine !== giroDigits(register[field])) {
      return { kind: "differs", field, invoice: invoice[field]!, register: register[field] };
    }
  }
  return null;
}

/** An org number as digits only. A VAT number ("SE556677889901") is the org
 *  number inside a country code and a trailing 01, and is taken as that. */
export const orgNoDigits = (orgNo: string | null | undefined): string | null => {
  const raw = (orgNo ?? "").trim();
  let d = raw.replace(/\D/g, "");
  if (/^SE/i.test(raw) && d.length === 12 && d.endsWith("01")) d = d.slice(0, 10);
  return d || null;
};

/**
 * The supplier in the register an invoice is from, by what it prints: the org
 * number first, then the bankgiro, then the plusgiro. An active supplier wins
 * over a retired one with the same number. Null when nothing matches, which is
 * an unknown supplier and not a guess.
 *
 * A giro match is a match on where the money goes, so it is only as good as
 * the giro. The export still checks it against the register (giroMismatch).
 */
export function matchSupplier<S extends { orgNo: string | null; bankgiro: string | null; plusgiro: string | null; active: boolean }>(
  invoice: { supplierOrgNo?: string | null; bankgiro?: string | null; plusgiro?: string | null },
  register: readonly S[],
): S | null {
  const tries: [string | null, (s: S) => string | null][] = [
    [orgNoDigits(invoice.supplierOrgNo), (s) => orgNoDigits(s.orgNo)],
    [giroDigits(invoice.bankgiro), (s) => giroDigits(s.bankgiro)],
    [giroDigits(invoice.plusgiro), (s) => giroDigits(s.plusgiro)],
  ];
  for (const [mine, theirs] of tries) {
    if (!mine) continue;
    const hits = register.filter((s) => theirs(s) === mine);
    if (hits.length) return hits.find((s) => s.active) ?? hits[0];
  }
  return null;
}
