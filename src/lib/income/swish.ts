// Reading a Swish export: the bank's "Transaktionsrapport" as a CSV file.
//
// Ported from intakt's report/swish.go (ParseSwishPayments), which this
// replaces, with the same rules, because days already booked were booked from
// what that parser read:
//
//   - The file is ISO-8859-1. Read as UTF-8, every å, ä and ö in a message
//     would come out as a replacement character. A file that is valid UTF-8 is
//     read as UTF-8, in case the bank ever changes, since Latin-1 bytes for
//     Swedish letters are not valid UTF-8 and cannot be mistaken for it.
//   - Lines starting with `*` are comments (the export's title line). The
//     first remaining line is the header.
//   - Quotes are lenient, as Go's LazyQuotes: a quote inside an unquoted field
//     is just a character.
//   - Every record has as many fields as the header, or the file is refused,
//     naming the line. A row that silently went missing would be money that
//     silently went missing.
//   - The day is Transdag, column 4 (Bokfdag, column 3, is when the bank
//     settled it). Rows outside [from, to], both inclusive, are skipped, and so
//     are rows whose date or amount cannot be read, or whose amount is zero:
//     summary lines and the like, all expected in a raw export.
//   - The amount, column 12, is "25.00" or "-50.25": exactly two decimals, a
//     minus sign in front for a refund.
//
// Pure: bytes in, payments out, so it is tested without a server.
import type { SwishPayment } from "./types";

const COL_TRANS_DATE = 4;
const COL_MESSAGE = 10;
const COL_AMOUNT = 12;
const MIN_COLUMNS = 13;

/** Thrown for a file that cannot be read. The message names the line. */
export class SwishParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SwishParseError";
  }
}

/** The file as text: UTF-8 if it is valid UTF-8, else ISO-8859-1. */
function decode(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^﻿/, "");
  } catch {
    // ISO-8859-1 maps every byte to the code point of the same number. Not
    // TextDecoder("latin1"), which is windows-1252 under the WHATWG spec and
    // differs for 0x80 to 0x9F.
    let text = "";
    for (let i = 0; i < bytes.length; i += 8192) {
      text += String.fromCharCode(...bytes.subarray(i, i + 8192));
    }
    return text;
  }
}

/** One record per line, with lenient quotes. Line numbers are 1-based. */
function* records(text: string): Generator<{ line: number; fields: string[] }> {
  const lines = text.split(/\r\n|\n|\r/);
  let i = 0;
  while (i < lines.length) {
    const startLine = i + 1;
    let line = lines[i++];
    if (line.startsWith("*")) continue;
    if (line === "" && i === lines.length) break;

    const fields: string[] = [];
    let field = "";
    let pos = 0;
    let quoted = false;
    let atStart = true;
    for (;;) {
      if (pos >= line.length) {
        if (quoted) {
          // A quoted field runs on over the line break.
          if (i >= lines.length) break;
          field += "\n";
          line = lines[i++];
          pos = 0;
          continue;
        }
        break;
      }
      const c = line[pos++];
      if (quoted) {
        if (c === '"') {
          if (line[pos] === '"') {
            field += '"';
            pos++;
          } else if (pos >= line.length || line[pos] === ",") {
            quoted = false;
          } else {
            // Lazy: a quote that neither doubles nor closes is a character.
            field += c;
          }
        } else {
          field += c;
        }
      } else if (c === ",") {
        fields.push(field);
        field = "";
        atStart = true;
        continue;
      } else if (c === '"' && atStart) {
        quoted = true;
      } else {
        field += c;
      }
      atStart = false;
    }
    fields.push(field);
    if (fields.length === 1 && fields[0] === "") continue;
    yield { line: startLine, fields };
  }
}

/** A real calendar day written YYYY-MM-DD: 2026-02-30 is not one. */
function isDay(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  // An impossible month is an invalid Date; an impossible day rolls over into
  // the next month. Either way it does not come back as itself.
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
}

/** "25.00" → 2500, "-50.25" → -5025, or null when it is not exactly that shape. */
export function parseSwishAmount(s: string): number | null {
  // The sign is taken off first and put back last. Read as part of the
  // kronor, "-0.50" would come back as +50 öre.
  const m = /^(-?)(\d+)\.(\d{2})$/.exec(s);
  if (!m) return null;
  const ore = Number(m[2]) * 100 + Number(m[3]);
  return m[1] ? -ore : ore;
}

/**
 * The payments in a Swish export dated from `from` to `to`, both ISO days and
 * both inclusive, in file order.
 */
export function parseSwishPayments(bytes: Uint8Array, from: string, to: string): SwishPayment[] {
  const payments: SwishPayment[] = [];
  let width: number | null = null;

  for (const { line, fields } of records(decode(bytes))) {
    if (width === null) {
      // The header. It sets how many fields every record must have.
      width = fields.length;
      continue;
    }
    if (fields.length !== width) {
      throw new SwishParseError(
        `line ${line}: ${fields.length} fields where the header has ${width}`,
      );
    }
    if (fields.length < MIN_COLUMNS) continue;

    const date = fields[COL_TRANS_DATE].trim();
    // ISO days compare as strings, and comparing days rather than instants is
    // what keeps the last day of a range in it, whatever the time zone.
    if (!isDay(date) || date < from || date > to) continue;

    const amount = parseSwishAmount(fields[COL_AMOUNT].trim());
    if (amount === null || amount === 0) continue;

    payments.push({ date, message: fields[COL_MESSAGE].trim(), amount });
  }

  return payments;
}
