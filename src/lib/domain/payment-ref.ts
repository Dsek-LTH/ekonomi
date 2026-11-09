// Comparing what an invoice says to pay to with what the supplier register says: the check between a
// forged invoice ("same supplier, new bankgiro") and the section's money. Pure; the register is Fortnox's.

/** A bankgiro or plusgiro as digits only, so "5050-1055" and "50501055" match. Null for nothing. */
export const giroDigits = (giro: string | null | undefined): string | null => {
  const d = (giro ?? "").replace(/\D/g, "");
  return d || null;
};

export type GiroMismatch = null | {
  kind: "differs";
  field: "bankgiro" | "plusgiro";
  invoice: string;
  register: string | null;
};

/** Whether the invoice asks to be paid somewhere the register does not know. An invoice printing neither number is paid to what the register has. */
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

/** An org number as digits only. A VAT number ("SE556677889901") is the org number inside a country code and a trailing 01. */
const orgNoDigits = (orgNo: string | null | undefined): string | null => {
  const raw = (orgNo ?? "").trim();
  let d = raw.replace(/\D/g, "");
  if (/^SE/i.test(raw) && d.length === 12 && d.endsWith("01")) d = d.slice(0, 10);
  return d || null;
};

/** The supplier in the register an invoice is from: org number, then bankgiro, then plusgiro; an active supplier wins over a retired one. Null when nothing matches. A giro match is only as good as the giro (the export checks giroMismatch). */
export function matchSupplier<
  S extends {
    orgNo: string | null;
    bankgiro: string | null;
    plusgiro: string | null;
    active: boolean;
  },
>(
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
