// Shared CSV primitives. Parsing is forgiving about delimiter, decimal separator and encoding, since
// every CSV is a spreadsheet export by someone else's tooling. Pure (domain/boundary.test.ts).

import { sekToOre } from "./money";

/** Split one CSV line into fields. Quotes are special only at a field boundary; a doubled quote inside is a literal quote. */
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

// The delimiters worth guessing between: Swedish Excel writes semicolon, the clipboard tab.
const CANDIDATE_DELIMITERS = [",", ";", "\t"];

/** Guess the delimiter from the header line by splitting with each candidate and taking the most fields (counting characters would let a quoted comma vote). Ties and no delimiter fall back to comma. */
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

/** "-1 234,50" / "-1234.50" / "5901.00" → öre integer, or null. Both decimal conventions are accepted: the file's delimiter implies which. */
export function amountToOre(raw: string): number | null {
  let s = raw.trim().replace(/\s/g, "");
  if (s.includes(",") && !s.includes(".")) s = s.replace(",", ".");
  // An empty string is 0 here, not null (bank importer behaviour). A caller that must tell absent from zero checks for blank first.
  const value = Number(s);
  if (!Number.isFinite(value)) return null;
  return sekToOre(value);
}

/** Decode an uploaded CSV's bytes. Excel writes UTF-8 with or without BOM, or Windows-1252, and a wrong guess silently mangles å ä ö: honour the BOM, try UTF-8, fall back to Windows-1252 on the replacement character. */
export function decodeCsvBytes(buf: Buffer): string {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return buf.subarray(3).toString("utf8");
  }
  const utf8 = buf.toString("utf8");
  // latin1 maps every byte to a code point, so it never fails, which is why it is the fallback.
  return utf8.includes("�") ? buf.toString("latin1") : utf8;
}
