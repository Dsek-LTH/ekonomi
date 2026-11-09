// Reads a Swish export: the bank's "Transaktionsrapport" CSV. Pure: bytes in, payments out.
//  - ISO-8859-1, unless the bytes are valid UTF-8 (Latin-1 Swedish letters are not).
//  - Lines starting with `*` are comments. The first remaining line is the header.
//  - Lenient quotes (a quote inside an unquoted field is a character), as Go's LazyQuotes.
//  - Every record must have the header's field count, or the file is refused naming the line.
//  - The day is Transdag (column 4, not Bokfdag). Rows outside [from, to], with unreadable date
//    or amount, or zero amount are skipped.
//  - Amount (column 12) is "25.00" or "-50.25" (refund).

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
    // Not TextDecoder("latin1"): that is windows-1252, which differs for 0x80 to 0x9F.
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
  // An impossible day rolls over into the next month and so does not come back as itself.
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
}

/** "25.00" -> 2500, "-50.25" -> -5025, or null when not exactly that shape. */
export function parseSwishAmount(s: string): number | null {
  // Sign off first, or "-0.50" would come back as +50 öre.
  const m = /^(-?)(\d+)\.(\d{2})$/.exec(s);
  if (!m) return null;
  const ore = Number(m[2]) * 100 + Number(m[3]);
  return m[1] ? -ore : ore;
}

/** The payments dated `from` to `to` (ISO days, inclusive), in file order. */
export function parseSwishPayments(bytes: Uint8Array, from: string, to: string): SwishPayment[] {
  const payments: SwishPayment[] = [];
  let width: number | null = null;

  for (const { line, fields } of records(decode(bytes))) {
    if (width === null) {
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
    // ISO days compare as strings, which keeps the last day in range whatever the time zone.
    if (!isDay(date) || date < from || date > to) continue;

    const amount = parseSwishAmount(fields[COL_AMOUNT].trim());
    if (amount === null || amount === 0) continue;

    payments.push({ date, message: fields[COL_MESSAGE].trim(), amount });
  }

  return payments;
}
