// Spreadsheet grid index for the budget sheets: fixed layout Konto, Beskrivning, Belopp, rows numbered from the top.
// References are stored bound to row identity and field key (`@L<lineItemId>:<fieldKey>`, `account(<CC>, <ACCT>)`), so they survive
// reordering. This grid converts them to and from row references (`#5`, `SEX01#5`).

import { effectiveKind } from "@/lib/budget";

type ColKind = "konto" | "text" | "number";

export const EXTRA_COLUMN_KEYS = ["x1", "x2", "x3", "x4", "x5", "x6"] as const;

export interface ColumnDef {
  key: string; // field key: konto | beskrivning | expression | <columnId>
  name: string;
  kind: ColKind; // konto = account-only; text = free string; number = formula cell (referenceable)
  custom: boolean;
  sortOrder: number;
}

// The fixed layout: Konto, Beskrivning, Belopp (the equation). A built-in's `name` is a key under `budget.col`.
const BUILTINS: ColumnDef[] = [
  { key: "konto", name: "konto", kind: "konto", custom: false, sortOrder: 0 },
  { key: "beskrivning", name: "beskrivning", kind: "text", custom: false, sortOrder: 100 },
  { key: "expression", name: "expression", kind: "number", custom: false, sortOrder: 1_000_000 },
];

export function orderedColumns(): ColumnDef[] {
  return [...BUILTINS].sort((a, b) => a.sortOrder - b.sortOrder);
}

// The legacy single-letter suffix (.C/.D/.E from before custom columns) maps here.
function legacyField(s: string): string {
  return s === "C" ? "quantity" : s === "D" ? "unitPrice" : s === "E" ? "expression" : s;
}

interface GridLineItem {
  id: string;
}
interface GridAccount {
  id: string;
  accountCode: string;
  lineItems: GridLineItem[];
}
export interface GridSheet {
  code: string;
  accounts: GridAccount[];
}

type RowKind = "section" | "account" | "line";
interface RowEntity {
  row: number;
  kind: RowKind;
  section?: "INCOME" | "COST";
  accountId?: string;
  accountCode?: string;
  lineId?: string;
}

export interface BudgetGrid {
  accountRow: Map<string, number>; // `${sheet}|${accountId}` → row (gutter)
  lineRow: Map<string, number>; // `${sheet}|${lineId}` → row (gutter)
  rowAt: Map<string, RowEntity>; // `${sheet}|${row}` → entity (reference → token)
  lineLoc: Map<string, { sheet: string; row: number }>; // lineId → location (token → reference)
  acctCodeRow: Map<string, number>; // `${sheet}|${accountCode}` → row (token → reference)
  sectionRow: Map<string, number>; // `${sheet}|INCOME` / `${sheet}|COST` → the section's heading row
  sheets: Set<string>; // every sheet code, for `#resultat` and the like
  columns: ColumnDef[];
}

export function buildGrid(sheets: GridSheet[], columns: ColumnDef[]): BudgetGrid {
  const accountRow = new Map<string, number>();
  const lineRow = new Map<string, number>();
  const rowAt = new Map<string, RowEntity>();
  const lineLoc = new Map<string, { sheet: string; row: number }>();
  const acctCodeRow = new Map<string, number>();
  const sectionRow = new Map<string, number>();

  for (const sheet of sheets) {
    const code = sheet.code;
    let r = 0;
    const income = sheet.accounts.filter((a) => effectiveKind(a.accountCode) === "INCOME");
    const cost = sheet.accounts.filter((a) => effectiveKind(a.accountCode) === "COST");
    const emit = (accts: GridAccount[], section: "INCOME" | "COST") => {
      r++;
      rowAt.set(`${code}|${r}`, { row: r, kind: "section", section });
      sectionRow.set(`${code}|${section}`, r);
      for (const a of accts) {
        r++;
        accountRow.set(`${code}|${a.id}`, r);
        acctCodeRow.set(`${code}|${a.accountCode}`, r);
        rowAt.set(`${code}|${r}`, {
          row: r,
          kind: "account",
          accountId: a.id,
          accountCode: a.accountCode,
        });
        for (const li of a.lineItems) {
          r++;
          lineRow.set(`${code}|${li.id}`, r);
          lineLoc.set(li.id, { sheet: code, row: r });
          rowAt.set(`${code}|${r}`, {
            row: r,
            kind: "line",
            lineId: li.id,
            accountId: a.id,
            accountCode: a.accountCode,
          });
        }
      }
    };
    emit(income, "INCOME");
    emit(cost, "COST");
  }

  return {
    accountRow,
    lineRow,
    rowAt,
    lineLoc,
    acctCodeRow,
    sectionRow,
    sheets: new Set(sheets.map((s) => s.code)),
    columns,
  };
}

// What a cost-centre code may hold, in step with POST /api/cost-centers: letters (Å/Ä/Ö included), digits, underscore, hyphen.
// The hyphen is unambiguous only inside `account(…)`: in a bare reference, `=SEX01-NARU#4` is a subtraction, so hyphenated sheets are reachable only through `account(…)`.
const CODE = String.raw`[\p{L}\p{N}_-]+`;
const REF_CODE = String.raw`[\p{L}\p{N}_]+`;

// A reference names a row: `#5`, or `SEX01#5` on another sheet. Belopp is the only column that holds a figure,
// so a row is enough. A sheet's totals are named the same way: `#intäkter`, `#kostnader`, `#resultat`.
const TOTAL_WORDS = { income: "intäkter", cost: "kostnader", result: "resultat" } as const;
const TOTAL_WORD = String.raw`int[äa]kter|kostnader|resultat`;
const ROW_REF = new RegExp(String.raw`^(?:(${REF_CODE}))?#(\d+|${TOTAL_WORD})$`, "iu");

function refToToken(ref: string, currentSheet: string, grid: BudgetGrid): string | null {
  const m = ROW_REF.exec(ref.trim());
  if (!m) return null;
  const sheet = m[1] ?? currentSheet;
  if (!/^\d/.test(m[2])) {
    const word = m[2].toLowerCase().replace("intakter", "intäkter");
    const fn = Object.entries(TOTAL_WORDS).find(([, w]) => w === word)?.[0];
    return grid.sheets.has(sheet) ? `${fn}(${sheet})` : null;
  }
  const e = grid.rowAt.get(`${sheet}|${parseInt(m[2], 10)}`);
  if (e?.kind === "line") return `@L${e.lineId}:expression`;
  if (e?.kind === "account") return `account(${sheet}, ${e.accountCode})`;
  // A section's heading row holds its total, the same figure as `#intäkter` / `#kostnader`.
  if (e?.kind === "section") return `${e.section === "INCOME" ? "income" : "cost"}(${sheet})`;
  return null;
}

const TOKEN_LINE = /^@L([a-z0-9]+):([A-Za-z0-9]+)$/i;
const TOKEN_ACCT = new RegExp(String.raw`^account\(\s*(${CODE})\s*,\s*(${CODE})\s*\)$`, "iu");
const TOKEN_TOTAL = new RegExp(String.raw`^(income|cost|result)\(\s*(${CODE})\s*\)$`, "iu");

function tokenToRef(token: string, currentSheet: string, grid: BudgetGrid): string | null {
  let m = TOKEN_LINE.exec(token);
  if (m) {
    const loc = grid.lineLoc.get(m[1]);
    // A token on another field (a retired column) has no row reference to show.
    if (!loc || (m[2] !== "expression" && legacyField(m[2]) !== "expression")) return null;
    return (loc.sheet === currentSheet ? "" : loc.sheet) + "#" + loc.row;
  }
  m = TOKEN_ACCT.exec(token);
  if (m) {
    const sheet = m[1];
    const row = grid.acctCodeRow.get(`${sheet}|${m[2]}`);
    if (row === undefined) return null;
    return (sheet === currentSheet ? "" : sheet) + "#" + row;
  }
  m = TOKEN_TOTAL.exec(token);
  if (m) {
    const sheet = m[2];
    // A hyphenated code would read as a subtraction, so that token stays as it is.
    if (sheet !== currentSheet && !new RegExp(`^${REF_CODE}$`, "u").test(sheet)) return null;
    const word = TOTAL_WORDS[m[1].toLowerCase() as keyof typeof TOTAL_WORDS];
    return (sheet === currentSheet ? "" : sheet) + "#" + word;
  }
  return null;
}

// The hyphen stays out of the lookbehind: in `=5-SEX01#4` the "-" is the operator.
const REF_WORD = new RegExp(
  String.raw`(?<![\p{L}\p{N}_#])((?:${REF_CODE})?#(?:\d+|${TOTAL_WORD}))(?![\p{L}\p{N}_])`,
  "giu",
);
const TOKEN_WORD = new RegExp(
  String.raw`@L[a-z0-9]+:[A-Za-z0-9]+|account\(\s*${CODE}\s*,\s*${CODE}\s*\)|(?:income|cost|result)\(\s*${CODE}\s*\)`,
  "giu",
);

// A reference that doesn't resolve to a real row is left as typed.
export function toStored(raw: string, currentSheet: string, grid: BudgetGrid): string {
  const s = raw.trim();
  if (!s.startsWith("=")) return s;
  return (
    "=" + s.slice(1).replace(REF_WORD, (whole) => refToToken(whole, currentSheet, grid) ?? whole)
  );
}

export function toDisplay(stored: string, currentSheet: string, grid: BudgetGrid): string {
  const s = stored.trim();
  if (!s.startsWith("=")) return s;
  return "=" + s.slice(1).replace(TOKEN_WORD, (tok) => tokenToRef(tok, currentSheet, grid) ?? tok);
}
