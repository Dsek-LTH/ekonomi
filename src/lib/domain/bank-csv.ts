// Parser for the bank's "Transaktionsrapport" CSV (Swedbank/Sparbanken Företagskonto export): Windows-1252, CRLF,
// a `*`-comment line, then the header row. The card is the trailing "K####" in Referens (not always present).
// Amounts are SEK with a sign; negative = outgoing. A row is dated by Transdag (matches the member's receipt),
// not Bokfdag; rows without Transdag (fees, interest) fall back to Bokfdag.
import { createHash } from "node:crypto";
import { amountToOre, splitCsvLine } from "@/lib/domain/csv";

interface ParsedTransaction {
  transactionDate: string; // YYYY-MM-DD, Transdag (Bokfdag if absent)
  description: string; // Referens with the trailing card token stripped
  amount: number; // öre, negative = outgoing
  cardLast4?: string; // the #### from a trailing "K####" token
  importHash: string; // stable per (account,date,ref,amount,occurrence)
}

interface ParseResult {
  transactions: ParsedTransaction[];
  cardLast4s: string[]; // distinct card numbers seen in the file
  skippedRows: number; // data rows that couldn't be parsed
}

// Pull "K1234" off the end of the Referens: the 4 digits and the description without the token.
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
    const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
    const date = isDate(transdag) ? transdag : isDate(bokfdag) ? bokfdag : null;
    if (date === null || amount === null) {
      skippedRows++;
      continue;
    }

    const { description, cardLast4 } = extractCard(referens);
    if (cardLast4) cardSet.add(cardLast4);

    // The occurrence index disambiguates identical same-day purchases while keeping re-imports stable.
    const naturalKey = `${kontonr}|${bokfdag}|${transdag}|${referens}|${cols[10].trim()}`;
    const occ = occurrence.get(naturalKey) ?? 0;
    occurrence.set(naturalKey, occ + 1);
    const importHash = createHash("sha256").update(`${naturalKey}|${occ}`).digest("hex");

    transactions.push({ transactionDate: date, description, amount, cardLast4, importHash });
  }

  return { transactions, cardLast4s: [...cardSet], skippedRows };
}
