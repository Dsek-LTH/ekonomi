// Parser for the bank's "Transaktionsrapport" CSV (Swedbank/Sparbanken
// Företagskonto export). The file is Windows-1252 encoded with CRLF, opens with
// a `*`-comment line, then a header row:
//   Radnr,Clnr,Kontonr,Produkt,Valuta,Bokfdag,Transdag,Valutadag,Referens,Text,Belopp
// The card used is the trailing "K####" inside the Referens field (not always
// present). Amounts are SEK with a sign; negative = outgoing.
import { createHash } from "node:crypto";

export interface ParsedTransaction {
  bookedDate: string; // YYYY-MM-DD
  description: string; // Referens with the trailing card token stripped
  amount: number; // öre, negative = outgoing
  cardLast4?: string; // the #### from a trailing "K####" token
  importHash: string; // stable per (account,date,ref,amount,occurrence)
}

export interface ParseResult {
  transactions: ParsedTransaction[];
  cardLast4s: string[]; // distinct card numbers seen in the file
  skippedRows: number; // data rows that couldn't be parsed
}

// Split one CSV line into fields, honouring double-quoted fields (which may
// contain commas). Quotes are only special at a field boundary.
function splitCsvLine(line: string): string[] {
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
    } else if (ch === ",") {
      out.push(field);
      field = "";
    } else {
      field += ch;
    }
  }
  out.push(field);
  return out;
}

// "-1 234,50" / "-1234.50" / "5901.00" → öre integer.
function amountToOre(raw: string): number | null {
  let s = raw.trim().replace(/\s/g, "");
  // If it uses a comma decimal (and no dot), normalise to a dot.
  if (s.includes(",") && !s.includes(".")) s = s.replace(",", ".");
  const value = Number(s);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

// Pull "K1234" off the end of the Referens, returning the 4 digits and the
// description with that token removed.
function extractCard(referens: string): { description: string; cardLast4?: string } {
  const m = referens.match(/\s+K(\d{4})\s*$/);
  if (!m) return { description: referens.trim() };
  return {
    description: referens.slice(0, m.index).trim(),
    cardLast4: m[1],
  };
}

export function parseBankCsv(text: string): ParseResult {
  const lines = text.split(/\r?\n/);
  const transactions: ParsedTransaction[] = [];
  const cardSet = new Set<string>();
  const occurrence = new Map<string, number>(); // natural key → count seen
  let skippedRows = 0;
  let seenHeader = false;

  for (const line of lines) {
    if (!line.trim()) continue;
    if (line.startsWith("*")) continue; // report header comment
    const cols = splitCsvLine(line);
    // Header row: skip it (and only it).
    if (!seenHeader && /^radnr$/i.test(cols[0]?.trim() ?? "")) {
      seenHeader = true;
      continue;
    }
    // Columns: 0 Radnr,1 Clnr,2 Kontonr,3 Produkt,4 Valuta,5 Bokfdag,
    //          6 Transdag,7 Valutadag,8 Referens,9 Text,10 Belopp
    if (cols.length < 11) {
      skippedRows++;
      continue;
    }
    const kontonr = cols[2].trim();
    const bokfdag = cols[5].trim();
    const transdag = cols[6].trim();
    const referens = cols[8].trim();
    const amount = amountToOre(cols[10]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(bokfdag) || amount === null) {
      skippedRows++;
      continue;
    }

    const { description, cardLast4 } = extractCard(referens);
    if (cardLast4) cardSet.add(cardLast4);

    // Occurrence index disambiguates genuinely-identical same-day purchases
    // while keeping re-imports stable (same file → same indices → same hashes).
    const naturalKey = `${kontonr}|${bokfdag}|${transdag}|${referens}|${cols[10].trim()}`;
    const occ = occurrence.get(naturalKey) ?? 0;
    occurrence.set(naturalKey, occ + 1);
    const importHash = createHash("sha256")
      .update(`${naturalKey}|${occ}`)
      .digest("hex");

    transactions.push({ bookedDate: bokfdag, description, amount, cardLast4, importHash });
  }

  return { transactions, cardLast4s: [...cardSet], skippedRows };
}
