// Spreadsheet grid index for the budget sheets.
//
// Every budget uses the same fixed 3-column layout: Konto, Beskrivning and
// Belopp (pinned last), which holds the equation itself. Column letters
// (A, B, C) are assigned left-to-right.
//
// References are stored bound to the row identity *and the field key* (not the
// letter), so they survive row reordering:
//   cell value    →  @L<lineItemId>:<fieldKey>   (fieldKey = expression | x1…x6)
//   account total →  account(<CC_CODE>, <ACCT_CODE>)
// Both round-trip back to a live A1 coordinate through this grid. The evaluator
// (lib/budget/eval.ts) understands both token forms.

import { effectiveKind } from "@/lib/budget";

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

type ColKind = "konto" | "text" | "number";

// The six fixed general-purpose columns between Beskrivning and Belopp.
export const EXTRA_COLUMN_KEYS = ["x1", "x2", "x3", "x4", "x5", "x6"] as const;

// One column in the final, ordered layout.
export interface ColumnDef {
  key: string;      // field key: konto | beskrivning | expression | <columnId>
  name: string;     // header label
  kind: ColKind;    // konto = account-only; text = free string; number = formula cell (referenceable)
  custom: boolean;  // true for user-defined columns (key === columnId)
  sortOrder: number;
  letter: string;   // assigned by position
}

// The fixed layout: Konto, Beskrivning, Belopp. Belopp holds the equation
// itself (e.g. "=2*TROJA_POLICY"), shown as "2 × TROJA_POLICY = 700", so the
// old general-purpose breakdown columns (x1…x6) are no longer part of the grid.
// A built-in's `name` is a key under `budget.col`, resolved by whichever sheet
// draws the header; a custom column would carry the name someone typed.
const BUILTINS: Omit<ColumnDef, "letter">[] = [
  { key: "konto", name: "konto", kind: "konto", custom: false, sortOrder: 0 },
  { key: "beskrivning", name: "beskrivning", kind: "text", custom: false, sortOrder: 100 },
  { key: "expression", name: "expression", kind: "number", custom: false, sortOrder: 1_000_000 },
];

// The full ordered column list, with letters assigned by position.
export function orderedColumns(): ColumnDef[] {
  const merged = [...BUILTINS].sort((a, b) => a.sortOrder - b.sortOrder);
  return merged.map((c, i) => ({ ...c, letter: LETTERS[i] ?? "?" }));
}

// Map a built-in cell key to its A1 letter is done via the grid; the legacy
// single-letter suffix (.C/.D/.E from before custom columns) maps here.
function legacyField(s: string): string {
  return s === "C" ? "quantity" : s === "D" ? "unitPrice" : s === "E" ? "expression" : s;
}

interface GridLineItem { id: string }
interface GridAccount { id: string; accountCode: string; lineItems: GridLineItem[] }
export interface GridSheet { code: string; accounts: GridAccount[] }

type RowKind = "section" | "account" | "line";
interface RowEntity { row: number; kind: RowKind; accountId?: string; accountCode?: string; lineId?: string }

export interface BudgetGrid {
  accountRow: Map<string, number>; // `${sheet}|${accountId}` → row (gutter)
  lineRow: Map<string, number>;    // `${sheet}|${lineId}` → row (gutter)
  rowAt: Map<string, RowEntity>;   // `${sheet}|${row}` → entity (A1 → token)
  lineLoc: Map<string, { sheet: string; row: number }>; // lineId → location (token → A1)
  acctCodeRow: Map<string, number>; // `${sheet}|${accountCode}` → row (token → A1)
  columns: ColumnDef[];
  letterToCol: Map<string, ColumnDef>;
  fieldToLetter: Map<string, string>;
  beloppLetter: string;
}

export function buildGrid(sheets: GridSheet[], columns: ColumnDef[]): BudgetGrid {
  const accountRow = new Map<string, number>();
  const lineRow = new Map<string, number>();
  const rowAt = new Map<string, RowEntity>();
  const lineLoc = new Map<string, { sheet: string; row: number }>();
  const acctCodeRow = new Map<string, number>();

  for (const sheet of sheets) {
    const code = sheet.code;
    let r = 0;
    const income = sheet.accounts.filter((a) => effectiveKind(a.accountCode) === "INCOME");
    const cost = sheet.accounts.filter((a) => effectiveKind(a.accountCode) === "COST");
    const emit = (accts: GridAccount[]) => {
      r++; rowAt.set(`${code}|${r}`, { row: r, kind: "section" });
      for (const a of accts) {
        r++;
        accountRow.set(`${code}|${a.id}`, r);
        acctCodeRow.set(`${code}|${a.accountCode}`, r);
        rowAt.set(`${code}|${r}`, { row: r, kind: "account", accountId: a.id, accountCode: a.accountCode });
        for (const li of a.lineItems) {
          r++;
          lineRow.set(`${code}|${li.id}`, r);
          lineLoc.set(li.id, { sheet: code, row: r });
          rowAt.set(`${code}|${r}`, { row: r, kind: "line", lineId: li.id, accountId: a.id, accountCode: a.accountCode });
        }
      }
    };
    emit(income);
    emit(cost);
  }

  const letterToCol = new Map<string, ColumnDef>();
  const fieldToLetter = new Map<string, string>();
  for (const c of columns) { letterToCol.set(c.letter, c); fieldToLetter.set(c.key, c.letter); }

  return {
    accountRow, lineRow, rowAt, lineLoc, acctCodeRow,
    columns, letterToCol, fieldToLetter,
    beloppLetter: fieldToLetter.get("expression") ?? "E",
  };
}

// What a cost-centre code may hold, kept in step with the format the settings
// screen accepts (POST /api/cost-centers): letters (Å/Ä/Ö included, this is a
// Swedish chart), digits, underscore and hyphen. A code the settings screen lets
// someone create has to be nameable in a formula.
//
// Two spellings, because the hyphen is only unambiguous in one of them. Inside
// `account(…)` the arguments are delimited, so it can be taken literally. In the
// bare A1 form it cannot: `=SEX01-NARU!C4` is a subtraction far more often than
// it is a sheet called SEX01-NARU, and reading it as the latter would quietly
// change what the formula means. So a hyphenated sheet is reachable through
// `account(…)` and not through A1, which fails visibly ("fel") rather than
// wrongly.
const CODE = String.raw`[\p{L}\p{N}_-]+`;
const A1_CODE = String.raw`[\p{L}\p{N}_]+`;

const A1 = new RegExp(String.raw`^(?:(${A1_CODE})!)?([A-Za-z])(\d+)$`, "u");

function a1ToToken(a1: string, currentSheet: string, grid: BudgetGrid): string | null {
  const m = A1.exec(a1.trim());
  if (!m) return null;
  const sheet = m[1] ?? currentSheet;
  const col = grid.letterToCol.get(m[2].toUpperCase());
  const row = parseInt(m[3], 10);
  const e = grid.rowAt.get(`${sheet}|${row}`);
  if (!col || !e) return null;
  if (col.kind === "number" && e.kind === "line") return `@L${e.lineId}:${col.key}`;
  if (col.key === "expression" && e.kind === "account") return `account(${sheet}, ${e.accountCode})`;
  return null;
}

const TOKEN_LINE = /^@L([a-z0-9]+):([A-Za-z0-9]+)$/i;
const TOKEN_ACCT = new RegExp(String.raw`^account\(\s*(${CODE})\s*,\s*(${CODE})\s*\)$`, "iu");

function tokenToA1(token: string, currentSheet: string, grid: BudgetGrid): string | null {
  let m = TOKEN_LINE.exec(token);
  if (m) {
    const loc = grid.lineLoc.get(m[1]);
    if (!loc) return null;
    const letter = grid.fieldToLetter.get(m[2]) ?? grid.fieldToLetter.get(legacyField(m[2]));
    if (!letter) return null;
    return (loc.sheet === currentSheet ? "" : `${loc.sheet}!`) + letter + loc.row;
  }
  m = TOKEN_ACCT.exec(token);
  if (m) {
    const sheet = m[1];
    const row = grid.acctCodeRow.get(`${sheet}|${m[2]}`);
    if (row === undefined) return null;
    return (sheet === currentSheet ? "" : `${sheet}!`) + grid.beloppLetter + row;
  }
  return null;
}

// The hyphen stays out of the lookbehind on purpose: in `=5-SEX01!C4` the "-"
// is the operator, and the reference after it still has to convert.
const A1_WORD = new RegExp(
  String.raw`(?<![\p{L}\p{N}_!])((?:${A1_CODE}!)?[A-Za-z]\d+)(?![\p{L}\p{N}_])`,
  "gu",
);
const TOKEN_WORD = new RegExp(
  String.raw`@L[a-z0-9]+:[A-Za-z0-9]+|account\(\s*${CODE}\s*,\s*${CODE}\s*\)`,
  "giu",
);

// What the user typed (A1) → what we store (field-bound tokens). Literals pass
// through. An A1 word that doesn't resolve to a real cell is left as-is.
export function toStored(raw: string, currentSheet: string, grid: BudgetGrid): string {
  const s = raw.trim();
  if (!s.startsWith("=")) return s;
  return "=" + s.slice(1).replace(A1_WORD, (whole) => a1ToToken(whole, currentSheet, grid) ?? whole);
}

// What we store (tokens) → what we show when editing (A1 coordinates).
export function toDisplay(stored: string, currentSheet: string, grid: BudgetGrid): string {
  const s = stored.trim();
  if (!s.startsWith("=")) return s;
  return "=" + s.slice(1).replace(TOKEN_WORD, (tok) => tokenToA1(tok, currentSheet, grid) ?? tok);
}
