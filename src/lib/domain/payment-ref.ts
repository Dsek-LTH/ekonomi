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
