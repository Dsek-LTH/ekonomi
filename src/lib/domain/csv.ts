// Shared CSV primitives. Every CSV this app ingests is a spreadsheet export
// written by someone else's tooling, so the parsing here is deliberately
// forgiving about the three things such files vary in and strict about
// nothing else: the delimiter, the decimal separator, and the encoding.
//
// Pure by construction (see domain/boundary.test.ts): bytes and strings in,
// strings and numbers out, no database and no filesystem.

/**
 * Split one CSV line into fields, honouring double-quoted fields (which may
 * contain the delimiter). Quotes are only special at a field boundary, and a
 * doubled quote inside a quoted field is a literal quote.
 */
export function splitCsvLine(line: string, delimiter: string = ","): string[] {
  const out: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      out.push(field);
      field = "";
    } else {
      field += ch;
    }
  }
  out.push(field);
  return out;
}

// The delimiters worth guessing between. Semicolon is what Excel writes when
// the machine's locale is Swedish (the comma is spoken for as the decimal
// separator there) and tab is what the clipboard carries, so a file that came
// out of a spreadsheet is as likely to be either of those as comma-separated.
const CANDIDATE_DELIMITERS = [",", ";", "\t"];

/**
 * Guess which delimiter a file uses, from its header line.
 *
 * Decided by splitting with each candidate and taking whichever yields the most
 * fields, rather than by counting raw characters: a quoted field containing a
 * comma would otherwise vote for the delimiter it is escaping. Ties, and a
 * header with no delimiter at all, fall back to comma.
 */
export function sniffDelimiter(headerLine: string): string {
  let best = ",";
  let bestCount = 1;
  for (const d of CANDIDATE_DELIMITERS) {
    const count = splitCsvLine(headerLine, d).length;
    if (count > bestCount) {
      best = d;
      bestCount = count;
    }
  }
  return best;
}

/**
 * "-1 234,50" / "-1234.50" / "5901.00" → öre integer, or null if not a number.
 *
 * Both decimal conventions are accepted because both turn up: a comma-delimited
 * export necessarily writes dot decimals, and a semicolon-delimited one
 * (Swedish Excel) necessarily writes comma decimals, so the file answers this
 * for itself and there is nothing to configure.
 */
export function amountToOre(raw: string): number | null {
  let s = raw.trim().replace(/\s/g, "");
  // If it uses a comma decimal (and no dot), normalise to a dot.
  if (s.includes(",") && !s.includes(".")) s = s.replace(",", ".");
  // Note an empty string is 0 here, not null, because that is what the bank
  // importer has always done with an empty Belopp. A caller that needs to tell
  // "absent" from "zero" (the budget importer does) must check for blank
  // before asking this.
  const value = Number(s);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

/**
 * Decode an uploaded CSV's bytes.
 *
 * Excel writes one of three things depending on which "CSV" menu entry was
 * used and which machine it ran on: UTF-8 with a BOM, UTF-8 without, or
 * Windows-1252. Guessing wrong does not fail. It silently mangles every å ä ö
 * in the file, so the BOM is honoured where present and UTF-8 is otherwise
 * tried first, falling back to Windows-1252 when the result contains the
 * replacement character that marks an invalid UTF-8 sequence.
 */
export function decodeCsvBytes(buf: Buffer): string {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return buf.subarray(3).toString("utf8");
  }
  const utf8 = buf.toString("utf8");
  // latin1 maps every byte to a code point, so it never fails. It is the
  // fallback precisely because it cannot be the thing that errors.
  return utf8.includes("�") ? buf.toString("latin1") : utf8;
}
