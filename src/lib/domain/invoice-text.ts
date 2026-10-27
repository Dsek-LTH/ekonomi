// Reading a supplier invoice's text for the fields the treasurer would
// otherwise type: amount, dates, invoice number, OCR, bankgiro, plusgiro,
// the supplier's org number, and "Er referens".
//
// Pure. The text comes from the PDF's own text layer (lib/server/pdf-text.ts),
// as lines in reading order. A scanned invoice has none, and then nothing is
// found, which is a fine answer: every field here is a suggestion, filled in
// only where the invoice had nothing, and checked by the treasurer before
// export.
//
// Found by label, the way a person reads an invoice: the value is what follows
// "Förfallodatum", on the same line or the next. Swedish invoices are
// regular enough about their labels for this to get most of them, and a field
// whose label is not recognised is simply left empty.

export interface InvoiceTextFields {
  amount?: number; // öre
  dueDate?: string; // YYYY-MM-DD
  invoiceDate?: string;
  invoiceNumber?: string;
  ocr?: string;
  bankgiro?: string;
  plusgiro?: string;
  supplierOrgNo?: string;
  /** "Er referens": often a name, and often, when the section asked for it, a
   *  cost centre code. Read for routing as well as shown. */
  reference?: string;
}

// ── Values ────────────────────────────────────────────────────────

/** A date in any of the shapes Swedish invoices print, as YYYY-MM-DD. */
export function parseDate(raw: string): string | null {
  const s = raw.trim();
  let y: string, m: string, d: string;
  let match = s.match(/\b(20\d{2})[-./ ]?(\d{2})[-./ ]?(\d{2})\b/);
  if (match) [, y, m, d] = match;
  else if ((match = s.match(/\b(\d{1,2})[./-](\d{1,2})[./-](20\d{2})\b/))) {
    [, d, m, y] = match;
  } else if ((match = s.match(/\b(\d{2})(\d{2})(\d{2})\b/))) {
    // YYMMDD, as a bankgiro slip prints it.
    [, y, m, d] = match;
    y = `20${y}`;
  } else return null;
  const mm = m.padStart(2, "0");
  const dd = d.padStart(2, "0");
  const iso = `${y}-${mm}-${dd}`;
  const date = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === iso ? iso : null;
}

/**
 * An amount as printed, "1 250,00", "1.250,00", "1250.00", "1 250 kr", into
 * öre. The last amount-shaped thing on the line, because a total line often
 * starts with something else that looks like a number ("Summa 3 st").
 */
export function parseAmount(raw: string): number | null {
  const found = raw.match(/\d{1,3}(?:[  .]\d{3})*(?:[.,]\d{2})|\d+(?:[.,]\d{2})?/g);
  if (!found) return null;
  const last = found[found.length - 1];
  const decimal = last.match(/[.,](\d{2})$/);
  const whole = (decimal ? last.slice(0, -3) : last).replace(/[  .,]/g, "");
  if (!whole) return null;
  const ore = Number(whole) * 100 + (decimal ? Number(decimal[1]) : 0);
  return Number.isFinite(ore) && ore > 0 ? ore : null;
}

// ── Labels ────────────────────────────────────────────────────────

/** The value after a label: the rest of its line, or the next line when the
 *  label stands alone (a two-column layout read line by line). */
function after(lines: readonly string[], label: RegExp): string[] {
  const out: string[] = [];
  lines.forEach((line, i) => {
    const m = line.match(label);
    if (!m) return;
    const rest = line.slice((m.index ?? 0) + m[0].length).replace(/^[\s:.]+/, "");
    if (rest) out.push(rest);
    if (lines[i + 1]) out.push(lines[i + 1]);
  });
  return out;
}

const first = <T>(xs: readonly string[], parse: (s: string) => T | null): T | undefined => {
  for (const x of xs) {
    const v = parse(x);
    if (v != null) return v;
  }
  return undefined;
};

// In order of how sure a label is about being the sum to pay. "Att betala"
// is that sum on every Swedish invoice that has one; a plain "Summa" may be a
// subtotal, so it is only asked when nothing better is there.
const AMOUNT_LABELS = [
  /(?:summa|belopp|totalt)?\s*att betala/i,
  /totalbelopp|totalsumma|total amount|amount due|total due/i,
  /\b(?:totalt|total|summa)\b/i,
];

const BG = /\b(\d{3,4}-\d{4})\b/;
const PG = /\b(\d{1,7}-\d)\b/;
const ORG = /\b(\d{6}-\d{4})\b/;

export function parseInvoiceText(
  lines: readonly string[],
  opts: { ownOrgNo?: string | null } = {},
): InvoiceTextFields {
  const out: InvoiceTextFields = {};

  for (const label of AMOUNT_LABELS) {
    const v = first(after(lines, label), parseAmount);
    if (v) {
      out.amount = v;
      break;
    }
  }

  // "Forfallodatum" too: a text layer drawn with a font that lacks the
  // Swedish letters drops them, and the label is still unmistakable.
  out.dueDate = first(after(lines, /f[öo]rfallo(?:datum|dag)|f[öo]rfaller|betala senast|sista betal\w*|due date/i), parseDate);
  out.invoiceDate = first(after(lines, /fakturadatum|invoice date/i), parseDate);

  out.invoiceNumber = first(after(lines, /faktura(?:nummer|nr\.?)|faktura nr\.?|invoice (?:no\.?|number)/i), (s) => {
    const m = s.match(/^\s*([A-Za-z0-9][A-Za-z0-9-/]{1,30})/);
    return m ? m[1] : null;
  });

  out.ocr = first(after(lines, /\bocr(?:-?nummer|-?nr)?\b|referensnummer/i), (s) => {
    const m = s.replace(/\s/g, "").match(/^(\d{2,25})/);
    return m ? m[1] : null;
  });

  out.bankgiro = first(after(lines, /\b(?:bankgiro|bg)\b(?:\s*nr\.?)?/i), (s) => s.match(BG)?.[1] ?? null);
  out.plusgiro = first(after(lines, /\b(?:plusgiro|postgiro|pg)\b(?:\s*nr\.?)?/i), (s) => s.match(PG)?.[1] ?? null);

  // The supplier's, not ours: the section's own org number is printed on the
  // invoice too, as the customer's.
  const own = opts.ownOrgNo ?? null;
  out.supplierOrgNo = first(
    [...after(lines, /org(?:anisations)?\.?\s*-?\s*n(?:umme)?r\.?|org\.? ?nr/i), ...lines],
    (s) => {
      const all = [...s.matchAll(new RegExp(ORG, "g"))].map((m) => m[1]);
      return all.find((o) => o !== own) ?? null;
    },
  );

  out.reference = first(after(lines, /\ber(?:t)? ref(?:erens)?\.?|your reference/i), (s) => {
    const v = s.trim().slice(0, 60);
    return v || null;
  });

  for (const k of Object.keys(out) as (keyof InvoiceTextFields)[]) {
    if (out[k] === undefined) delete out[k];
  }
  return out;
}
